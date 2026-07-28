const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const ticketModel = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')
const statusSchema = require('../../src/models/ticketStatus')

// Regression coverage for GH-148: ticketsV2.links.add/remove let a caller
// link (and thereby read the subject/status of, via the populated response)
// a ticket in a group they cannot see, and links.remove had no group check
// at all on either side. Both handlers now run assertTicketGroupVisible on
// the source AND the target before mutating anything.
describe('ticket links — group visibility enforcement', function () {
  const baseUrl = 'http://localhost:3111'
  const memberToken = 'links-group-member-token'

  let memberUser
  let forbiddenGroup
  let ownTicketUid
  let ownTicketId
  let foreignTicketUid
  let foreignTicketId

  before(async function () {
    const group = await groupSchema.getGroupByName('TEST')
    const userRole = (await roleSchema.getRoles()).find(r => r.normalized === 'user')
    memberUser = await userSchema.create({
      username: 'links.group.member',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Links Group Member',
      email: 'links.group.member@trudesk.io',
      role: userRole._id,
      accessToken: memberToken
    })

    group.members.push(memberUser._id)
    await group.save()

    forbiddenGroup = await groupSchema.create({ name: 'Links Forbidden Group' })

    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    const status = await statusSchema.findOne({ uid: 0 })

    const ownTicket = await ticketModel.create({
      owner: memberUser._id,
      group: group._id,
      type: type._id,
      status: status._id,
      priority: priority._id,
      subject: 'Links visibility — own ticket',
      issue: 'fixture'
    })
    ownTicketUid = ownTicket.uid
    ownTicketId = ownTicket._id

    const foreignTicket = await ticketModel.create({
      owner: memberUser._id,
      group: forbiddenGroup._id,
      type: type._id,
      status: status._id,
      priority: priority._id,
      subject: 'Links visibility — foreign ticket',
      issue: 'fixture'
    })
    foreignTicketUid = foreignTicket.uid
    foreignTicketId = foreignTicket._id
  })

  after(async function () {
    if (ownTicketId) await ticketModel.deleteOne({ _id: ownTicketId })
    if (foreignTicketId) await ticketModel.deleteOne({ _id: foreignTicketId })
    if (forbiddenGroup) await groupSchema.deleteOne({ _id: forbiddenGroup._id })
    if (memberUser) {
      await groupSchema.updateOne({ name: 'TEST' }, { $pull: { members: memberUser._id } })
      await userSchema.deleteOne({ _id: memberUser._id })
    }
  })

  function post (path, body) {
    return new Promise(function (resolve) {
      superagent
        .post(baseUrl + path)
        .set('accesstoken', memberToken)
        .type('json')
        .send(body)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  function del (path) {
    return new Promise(function (resolve) {
      superagent
        .delete(baseUrl + path)
        .set('accesstoken', memberToken)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  it('rejects linking an own ticket to a ticket in an invisible group', async function () {
    const res = await post('/api/v2/tickets/' + ownTicketUid + '/links', { targetUid: foreignTicketUid })

    expect(res.status).to.equal(403)
    expect(res.body.success).to.equal(false)

    const fresh = await ticketModel.findOne({ _id: ownTicketId })
    expect(fresh.linkedTickets).to.have.lengthOf(0)
  })

  it('rejects linking when the source ticket is the one in an invisible group', async function () {
    const res = await post('/api/v2/tickets/' + foreignTicketUid + '/links', { targetUid: ownTicketUid })

    expect(res.status).to.equal(403)
    expect(res.body.success).to.equal(false)

    const fresh = await ticketModel.findOne({ _id: foreignTicketId })
    expect(fresh.linkedTickets).to.have.lengthOf(0)
  })

  it('rejects unlinking across the same group boundary', async function () {
    // Force a link directly through the model (bypassing the API) so we can
    // verify `links.remove` itself is gated, independent of `links.add`.
    const own = await ticketModel.findOne({ _id: ownTicketId })
    const foreign = await ticketModel.findOne({ _id: foreignTicketId })
    own.linkedTickets.push({ ticket: foreign._id, linkType: 'related' })
    foreign.linkedTickets.push({ ticket: own._id, linkType: 'related' })
    await own.save()
    await foreign.save()

    const res = await del('/api/v2/tickets/' + ownTicketUid + '/links/' + foreignTicketUid)

    expect(res.status).to.equal(403)
    expect(res.body.success).to.equal(false)

    const fresh = await ticketModel.findOne({ _id: ownTicketId })
    expect(fresh.linkedTickets).to.have.lengthOf(1)
  })
})

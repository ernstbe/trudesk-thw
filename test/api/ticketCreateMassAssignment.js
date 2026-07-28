/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const ticketModel = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')
const notificationModel = require('../../src/models/notification')

// Regression coverage for GH-149: ticketsV2.create cast req.body straight
// into `new TicketSchema(postData)` with no whitelist beyond owner/status/
// subscribers/history/checklist. comments/notes let a caller forge the
// owner+date of a comment/note and inject internal notes without the
// tickets:notes permission; metadata was fully attacker-controlled;
// assignee/additionalAssignees were cast onto the document without going
// through the notify/subscribe path every other assignment flow uses.
describe('ticket create — mass-assignment whitelist', function () {
  const baseUrl = 'http://localhost:3111'
  const memberToken = 'create-mass-assign-member-token'

  let memberUser
  let targetUser
  let testGroupId
  let typeId
  let priorityId
  const createdTicketIds = []

  before(async function () {
    const group = await groupSchema.getGroupByName('TEST')
    testGroupId = group._id.toString()

    const userRole = (await roleSchema.getRoles()).find(r => r.normalized === 'user')
    memberUser = await userSchema.create({
      username: 'create.mass.assign.member',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Create Mass Assign Member',
      email: 'create.mass.assign.member@trudesk.io',
      role: userRole._id,
      accessToken: memberToken
    })
    group.members.push(memberUser._id)
    await group.save()

    targetUser = await userSchema.getUserByUsername('fake.user')

    const type = await tickettype.getTypeByName('Task')
    typeId = type._id.toString()
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    priorityId = priority._id.toString()
  })

  after(async function () {
    for (const id of createdTicketIds) await ticketModel.deleteOne({ _id: id })
    await notificationModel.deleteMany({ owner: targetUser._id, 'data.ticket': { $exists: true } })
    if (memberUser) {
      await groupSchema.updateOne({ name: 'TEST' }, { $pull: { members: memberUser._id } })
      await userSchema.deleteOne({ _id: memberUser._id })
    }
  })

  function post (body) {
    return new Promise(function (resolve) {
      superagent
        .post(baseUrl + '/api/v2/tickets')
        .set('accesstoken', memberToken)
        .type('json')
        .send(body)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  function basePayload (extra) {
    return Object.assign({
      subject: 'Mass assignment test',
      issue: 'body',
      type: typeId,
      group: testGroupId,
      priority: priorityId,
      tags: []
    }, extra || {})
  }

  it('strips comments/notes/metadata supplied at create time', async function () {
    const forgedDate = new Date('2000-01-01')
    const res = await post(basePayload({
      comments: [{ owner: targetUser._id.toString(), date: forgedDate, comment: '<img src=x onerror=alert(1)>' }],
      notes: [{ owner: targetUser._id.toString(), note: 'injected internal note' }],
      metadata: { hacked: true }
    }))

    expect(res.status).to.equal(200)
    expect(res.body.success).to.equal(true)
    createdTicketIds.push(res.body.ticket._id)

    const fresh = await ticketModel.findOne({ _id: res.body.ticket._id })
    expect(fresh.comments).to.have.lengthOf(0)
    expect(fresh.notes).to.have.lengthOf(0)
    expect(fresh.metadata && fresh.metadata.hacked).to.not.be.true
  })

  it('sets assignee through the validating path with history + subscriber + notification', async function () {
    const res = await post(basePayload({ assignee: targetUser._id.toString() }))

    expect(res.status).to.equal(200)
    expect(res.body.success).to.equal(true)
    createdTicketIds.push(res.body.ticket._id)

    const fresh = await ticketModel.findOne({ _id: res.body.ticket._id })
    expect(fresh.assignee.toString()).to.equal(targetUser._id.toString())
    expect(fresh.subscribers.map(s => s.toString())).to.include(targetUser._id.toString())
    expect(fresh.history.some(h => h.action === 'ticket:set:assignee')).to.be.true

    const notification = await notificationModel.findOne({
      owner: targetUser._id,
      'data.ticket.uid': res.body.ticket.uid
    })
    expect(notification).to.exist
  })

  it('rejects a malformed assignee id', async function () {
    const res = await post(basePayload({ assignee: 'not-an-object-id' }))

    expect(res.status).to.equal(400)
    expect(res.body.success).to.equal(false)
  })
})

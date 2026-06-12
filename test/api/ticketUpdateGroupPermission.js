/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const ticketModel = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')

// Regression coverage for the bug where any authenticated user with the
// generic `tickets:update` permission (the default user role has it) could
// PUT an arbitrary group id onto a ticket — the server simply persisted
// whatever group was in the request body. Both v1 (PUT /api/v1/tickets/:id)
// and v2 (PUT /api/v2/tickets/:uid) now reject group moves into groups the
// caller cannot reach via their team→department mapping (admin/agent) or
// direct membership (everyone else), mirroring the create-side check from
// PR #97. The check lives in the shared ticketUpdateHelper.
describe('ticket update — group access enforcement', function () {
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
  const memberToken = 'update-group-member-token'

  let memberUser
  let memberGroup
  let forbiddenGroup
  let testGroupId
  let ticketUid
  let ticketId

  before(async function () {
    const group = await groupSchema.getGroupByName('TEST')
    testGroupId = group._id.toString()

    const userRole = (await roleSchema.getRoles()).find(r => r.normalized === 'user')
    memberUser = await userSchema.create({
      username: 'update.group.member',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Update Group Member',
      email: 'update.group.member@trudesk.io',
      role: userRole._id,
      accessToken: memberToken
    })

    // The member can see TEST (where the fixture ticket lives) and one
    // additional group — but NOT the forbidden group.
    group.members.push(memberUser._id)
    await group.save()

    memberGroup = await groupSchema.create({
      name: 'Update Allowed Group',
      members: [memberUser._id]
    })
    forbiddenGroup = await groupSchema.create({ name: 'Update Forbidden Group' })

    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})

    const res = await superagent
      .post(baseUrl + '/api/v1/tickets/create')
      .set('accesstoken', adminToken)
      .type('json')
      .send({
        subject: 'group move fixture ticket',
        issue: 'Fixture used by the update group permission tests',
        type: type._id.toString(),
        group: testGroupId,
        priority: priority._id.toString(),
        tags: []
      })

    if (res.status !== 200 || !res.body.ticket) {
      throw new Error('Fixture ticket creation failed: ' + JSON.stringify(res.body))
    }
    ticketUid = res.body.ticket.uid
    ticketId = res.body.ticket._id
  })

  after(async function () {
    if (ticketId) await ticketModel.deleteOne({ _id: ticketId })
    if (memberGroup) await groupSchema.deleteOne({ _id: memberGroup._id })
    if (forbiddenGroup) await groupSchema.deleteOne({ _id: forbiddenGroup._id })
    if (memberUser) {
      await groupSchema.updateOne({ name: 'TEST' }, { $pull: { members: memberUser._id } })
      await userSchema.deleteOne({ _id: memberUser._id })
    }
  })

  function put (path, body, token) {
    return new Promise(function (resolve) {
      superagent
        .put(baseUrl + path)
        .set('accesstoken', token)
        .type('json')
        .send(body)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  async function freshTicket () {
    return ticketModel.findOne({ uid: ticketUid })
  }

  it('PUT /api/v1/tickets/:id returns 403 when moving into an inaccessible group', async function () {
    const res = await put('/api/v1/tickets/' + ticketId, { group: forbiddenGroup._id.toString() }, memberToken)

    expect(res.status).to.equal(403)
    expect(res.body.success).to.equal(false)
    expect(res.body.error).to.match(/Forbidden/i)

    const fresh = await freshTicket()
    expect(fresh.group.toString()).to.equal(testGroupId)
  })

  it('PUT /api/v2/tickets/:uid returns 403 when moving into an inaccessible group', async function () {
    const res = await put(
      '/api/v2/tickets/' + ticketUid,
      { ticket: { group: forbiddenGroup._id.toString() } },
      memberToken
    )

    expect(res.status).to.equal(403)
    expect(res.body.success).to.equal(false)
    expect(res.body.error).to.match(/Forbidden/i)

    const fresh = await freshTicket()
    expect(fresh.group.toString()).to.equal(testGroupId)
  })

  it('returns 403 for an admin moving into a group outside their departments', async function () {
    // The seeded admin reaches groups via TEST Department, which does not
    // contain the forbidden group — admins/agents stay bound to their
    // team→department mapping, same as on create.
    const res = await put(
      '/api/v2/tickets/' + ticketUid,
      { ticket: { group: forbiddenGroup._id.toString() } },
      adminToken
    )

    expect(res.status).to.equal(403)

    const fresh = await freshTicket()
    expect(fresh.group.toString()).to.equal(testGroupId)
  })

  it('allows a member to move the ticket into a group they belong to', async function () {
    const res = await put(
      '/api/v2/tickets/' + ticketUid,
      { ticket: { group: memberGroup._id.toString() } },
      memberToken
    )

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true

    const fresh = await freshTicket()
    expect(fresh.group.toString()).to.equal(memberGroup._id.toString())

    // move it back for the remaining assertions
    await put('/api/v2/tickets/' + ticketUid, { ticket: { group: testGroupId } }, memberToken)
  })

  it('accepts an unchanged group in the payload without an access check trip', async function () {
    const res = await put(
      '/api/v2/tickets/' + ticketUid,
      { ticket: { group: testGroupId, subject: 'unchanged group payload' } },
      memberToken
    )

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true

    const fresh = await freshTicket()
    expect(fresh.subject).to.equal('unchanged group payload')
    expect(fresh.group.toString()).to.equal(testGroupId)
  })
})

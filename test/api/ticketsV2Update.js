/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

// Covers PUT /api/v2/tickets/:uid (ticketsV2.update), which was a stub that
// returned success without persisting anything. The handler now applies the
// same field whitelist as v1 apiTickets.update via the shared
// src/controllers/api/ticketUpdateHelper.js.
describe('api/v2/tickets PUT /:uid (update)', function () {
  const agent = superagent.agent()
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  const ticketModel = require('../../src/models/ticket')
  const groupSchema = require('../../src/models/group')
  const userSchema = require('../../src/models/user')
  const roleSchema = require('../../src/models/role')
  const statusSchema = require('../../src/models/ticketStatus')
  const prioritySchema = require('../../src/models/ticketpriority')
  const tickettype = require('../../src/models/tickettype')

  let ticketUid
  let ticketId
  let groupId
  let secondGroup
  let restrictedRole
  let restrictedUser

  before(async function () {
    // Session login as the seeded admin (same pattern as test/api/ticketsV2.js)
    await new Promise(function (resolve, reject) {
      agent
        .post(baseUrl + '/login')
        .type('json')
        .send({
          'login-username': 'trudesk',
          'login-password': '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW'
        })
        .end(function (err, res) {
          if (err) return reject(err)
          if (res.status !== 200) return reject(new Error('login failed: ' + res.status))
          resolve()
        })
    })

    const group = await groupSchema.getGroupByName('TEST')
    groupId = group._id.toString()

    secondGroup = await groupSchema.create({ name: 'V2 Update Target Group' })

    // The update helper now enforces the same group access check as ticket
    // create: the admin reaches groups via team→department, so the move
    // target has to live in the seeded TEST Department too.
    const departmentSchema = require('../../src/models/department')
    await departmentSchema.updateOne({ name: 'TEST Department' }, { $push: { groups: secondGroup._id } })

    // A user whose role lacks tickets:update — must be rejected by the
    // canUser('tickets:update') gate on the route.
    restrictedRole = await roleSchema.create({
      name: 'V2 Update Restricted',
      description: 'view-only role for v2 update permission test',
      grants: ['tickets:view']
    })
    // canThis() resolves grants from global.roles. Don't call
    // permissions.register() here — it would replace the whole cache with
    // lean docs (frozen virtuals, see test/models/userAssignees.js) for the
    // rest of the suite. Just append the new role and remove it in after().
    global.roles.push(restrictedRole)

    restrictedUser = await userSchema.create({
      username: 'v2update.restricted',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'V2 Update Restricted',
      email: 'v2update.restricted@trudesk.io',
      role: restrictedRole._id,
      accessToken: 'v2update-restricted-token'
    })

    // Fixture ticket via the v1 create endpoint
    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})

    const res = await new Promise(function (resolve, reject) {
      superagent
        .post(baseUrl + '/api/v1/tickets/create')
        .set('accesstoken', adminToken)
        .type('json')
        .send({
          subject: 'v2 update fixture ticket',
          issue: 'Fixture used by the v2 update tests',
          type: type._id.toString(),
          group: groupId,
          priority: priority._id.toString(),
          tags: []
        })
        .end(function (err, response) {
          if (err) return reject(err)
          resolve(response)
        })
    })

    if (res.status !== 200 || !res.body.ticket) {
      throw new Error('Fixture ticket creation failed: ' + JSON.stringify(res.body))
    }
    ticketUid = res.body.ticket.uid
    ticketId = res.body.ticket._id
  })

  after(async function () {
    if (ticketId) await ticketModel.deleteOne({ _id: ticketId })
    if (secondGroup) {
      const departmentSchema = require('../../src/models/department')
      await departmentSchema.updateOne({ name: 'TEST Department' }, { $pull: { groups: secondGroup._id } })
      await groupSchema.deleteOne({ _id: secondGroup._id })
    }
    if (restrictedUser) await userSchema.deleteOne({ _id: restrictedUser._id })
    if (restrictedRole) {
      await roleSchema.deleteOne({ _id: restrictedRole._id })
      global.roles = global.roles.filter(r => r._id.toString() !== restrictedRole._id.toString())
    }
  })

  function put (path, body, token) {
    return new Promise(function (resolve) {
      const request = token ? superagent.put(baseUrl + path).set('accesstoken', token) : agent.put(baseUrl + path)
      request
        .type('json')
        .send(body || {})
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  async function freshTicket () {
    return ticketModel.findOne({ uid: ticketUid })
  }

  it('rejects a request without a ticket object in the body', async function () {
    const res = await put('/api/v2/tickets/' + ticketUid, {})
    expect(res.status).to.equal(400)
  })

  it('returns 404 for an unknown ticket uid', async function () {
    const res = await put('/api/v2/tickets/999999', { ticket: { subject: 'nope' } })
    expect(res.status).to.equal(404)
  })

  it('persists subject, priority and status', async function () {
    const priorities = await prioritySchema.find({})
    expect(priorities.length).to.be.at.least(2)

    const current = await freshTicket()
    const newPriority = priorities.find(p => p._id.toString() !== current.priority._id.toString())
    const pending = await statusSchema.findOne({ name: 'Pending' })

    const res = await put('/api/v2/tickets/' + ticketUid, {
      ticket: {
        subject: 'v2 update persisted subject',
        priority: newPriority._id.toString(),
        status: pending._id.toString()
      }
    })

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    expect(res.body.ticket).to.be.a('object')

    const fresh = await freshTicket()
    expect(fresh.subject).to.equal('v2 update persisted subject')
    expect(fresh.priority._id.toString()).to.equal(newPriority._id.toString())
    expect(fresh.status.toString()).to.equal(pending._id.toString())
  })

  it('persists a group move', async function () {
    const res = await put('/api/v2/tickets/' + ticketUid, {
      ticket: { group: secondGroup._id.toString() }
    })

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true

    const fresh = await freshTicket()
    expect(fresh.group.toString()).to.equal(secondGroup._id.toString())

    // move it back so later tests / fixtures see the original group
    await put('/api/v2/tickets/' + ticketUid, { ticket: { group: groupId } })
  })

  it('sets the dueDate and writes a single history entry', async function () {
    const dueDate = new Date('2030-01-15T12:00:00.000Z')
    const before = await freshTicket()
    const dueDateEntriesBefore = before.history.filter(h => h.action === 'ticket:set:duedate').length

    const res = await put('/api/v2/tickets/' + ticketUid, { ticket: { dueDate: dueDate.toISOString() } })
    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true

    const fresh = await freshTicket()
    expect(fresh.dueDate).to.exist
    expect(new Date(fresh.dueDate).getTime()).to.equal(dueDate.getTime())
    expect(fresh.history.filter(h => h.action === 'ticket:set:duedate').length).to.equal(dueDateEntriesBefore + 1)

    // sending the identical dueDate again must NOT add another history entry
    const res2 = await put('/api/v2/tickets/' + ticketUid, { ticket: { dueDate: dueDate.toISOString() } })
    expect(res2.status).to.equal(200)
    const unchanged = await freshTicket()
    expect(unchanged.history.filter(h => h.action === 'ticket:set:duedate').length).to.equal(dueDateEntriesBefore + 1)
  })

  it('clears the dueDate via null and omits the field from payloads', async function () {
    const res = await put('/api/v2/tickets/' + ticketUid, { ticket: { dueDate: null } })
    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true

    const fresh = await freshTicket()
    // The field must be gone entirely, not stored as an explicit null: a
    // `"dueDate": null` in list payloads crashed strict clients (the PWA)
    // and blanked their entire ticket list.
    expect(fresh.dueDate).to.equal(undefined)
    expect(Object.prototype.hasOwnProperty.call(fresh, 'dueDate')).to.equal(false)

    // The history entry for a clear reads "removed" instead of "set to: undefined".
    const clearEntries = fresh.history.filter(h => h.action === 'ticket:set:duedate')
    expect(clearEntries[clearEntries.length - 1].description).to.equal('Ticket Due Date removed')
  })

  it('rejects an unparsable dueDate with 400', async function () {
    const res = await put('/api/v2/tickets/' + ticketUid, { ticket: { dueDate: 'not-a-date' } })
    expect(res.status).to.equal(400)
  })

  it('returns 400 on a schema validation error (bogus status id)', async function () {
    const res = await put('/api/v2/tickets/' + ticketUid, { ticket: { status: 'definitely-not-an-objectid' } })
    expect(res.status).to.equal(400)
  })

  it('ignores non-whitelisted fields (owner / uid stay untouched)', async function () {
    const before = await freshTicket()
    const ownerBefore = (before.owner._id || before.owner).toString()

    const res = await put('/api/v2/tickets/' + ticketUid, {
      ticket: {
        owner: restrictedUser._id.toString(),
        uid: 424242,
        deleted: true,
        subject: 'whitelist check subject'
      }
    })
    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true

    const fresh = await freshTicket()
    expect(fresh.subject).to.equal('whitelist check subject')
    expect((fresh.owner._id || fresh.owner).toString()).to.equal(ownerBefore)
    expect(fresh.uid).to.equal(before.uid)
    expect(fresh.deleted).to.equal(false)
  })

  it('rejects a user whose role lacks tickets:update with 401', async function () {
    const res = await put(
      '/api/v2/tickets/' + ticketUid,
      { ticket: { subject: 'should never persist' } },
      'v2update-restricted-token'
    )
    expect(res.status).to.equal(401)

    const fresh = await freshTicket()
    expect(fresh.subject).to.not.equal('should never persist')
  })
})

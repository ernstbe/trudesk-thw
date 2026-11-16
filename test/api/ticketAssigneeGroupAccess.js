/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const groupSchema = require('../../src/models/group')
const teamSchema = require('../../src/models/team')
const departmentSchema = require('../../src/models/department')
const ticketModel = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')

// Regression coverage for the bug where a ticket could be assigned to an
// agent who cannot see the ticket's group (e.g. a Stab agent on a Jugend
// ticket): the assign paths only validated the caller, never the assignee.
// Every assign path now requires the (additional) assignee to have the
// ticket's group in their resolveVisibleGroups set, and the agent list
// accepts ?group= so pickers only offer assignable people.
describe('ticket assignee — group access enforcement', function () {
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  let insideAgent
  let outsideAgent
  let outsideGroup
  let outsideTeam
  let outsideDepartment
  let insideTeam
  let testGroupId
  let ticketUid
  let ticketId
  let typeId
  let priorityId

  before(async function () {
    const group = await groupSchema.getGroupByName('TEST')
    testGroupId = group._id.toString()

    insideAgent = await userSchema.create({
      username: 'assign.inside',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Assign Inside',
      email: 'assign.inside@trudesk.io',
      role: global.supportRoleId
    })
    outsideAgent = await userSchema.create({
      username: 'assign.outside',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Assign Outside',
      email: 'assign.outside@trudesk.io',
      role: global.supportRoleId
    })

    // inside: team → TEST Department (→ TEST group)
    insideTeam = await teamSchema.create({ name: 'Assign Inside Team', members: [insideAgent._id] })
    await departmentSchema.updateOne({ name: 'TEST Department' }, { $push: { teams: insideTeam._id } })

    // outside: own team → own department → a different group only
    outsideGroup = await groupSchema.create({ name: 'Assign Outside Group' })
    outsideTeam = await teamSchema.create({ name: 'Assign Outside Team', members: [outsideAgent._id] })
    outsideDepartment = await departmentSchema.create({
      name: 'Assign Outside Department',
      teams: [outsideTeam._id],
      groups: [outsideGroup._id]
    })

    const type = await tickettype.getTypeByName('Task')
    typeId = type._id.toString()
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    priorityId = priority._id.toString()

    const res = await superagent
      .post(baseUrl + '/api/v1/tickets/create')
      .set('accesstoken', adminToken)
      .type('json')
      .send({
        subject: 'assignee group fixture ticket',
        issue: 'Fixture used by the assignee group access tests',
        type: typeId,
        group: testGroupId,
        priority: priorityId,
        tags: []
      })

    if (res.status !== 200 || !res.body.ticket) {
      throw new Error('Fixture ticket creation failed: ' + JSON.stringify(res.body))
    }
    ticketUid = res.body.ticket.uid
    ticketId = res.body.ticket._id
  })

  after(async function () {
    await ticketModel.deleteMany({ subject: /^assignee group fixture/ })
    await departmentSchema.updateOne({ name: 'TEST Department' }, { $pull: { teams: insideTeam._id } })
    await departmentSchema.deleteOne({ _id: outsideDepartment._id })
    await teamSchema.deleteMany({ _id: { $in: [insideTeam._id, outsideTeam._id] } })
    await groupSchema.deleteOne({ _id: outsideGroup._id })
    await userSchema.deleteMany({ _id: { $in: [insideAgent._id, outsideAgent._id] } })
  })

  function send (method, path, body) {
    return new Promise(function (resolve) {
      const req = superagent[method](baseUrl + path)
        .set('accesstoken', adminToken)
        .ok(function () { return true })
      if (body !== undefined) req.type('json').send(body)
      req.end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  async function freshTicket () {
    return ticketModel.findOne({ uid: ticketUid })
  }

  it('PUT /api/v2/tickets/:uid rejects an assignee without access to the group', async function () {
    const res = await send('put', '/api/v2/tickets/' + ticketUid, { ticket: { assignee: outsideAgent._id.toString() } })

    expect(res.status).to.equal(403)
    expect(res.body.success).to.equal(false)
    const fresh = await freshTicket()
    expect(fresh.assignee).to.not.exist
  })

  it('PUT /api/v1/tickets/:id rejects an assignee without access to the group', async function () {
    const res = await send('put', '/api/v1/tickets/' + ticketId, { assignee: outsideAgent._id.toString() })

    expect(res.status).to.equal(403)
    const fresh = await freshTicket()
    expect(fresh.assignee).to.not.exist
  })

  it('ticket.setAssignee (v1 PUT /:id/assignee, socket assign) rejects an assignee without access', async function () {
    // The v1 route itself needs the 'ticket:setAssignee' grant, which no
    // seeded role carries, so exercise the shared model method directly.
    const ticket = await freshTicket()
    let err
    try {
      await ticket.setAssignee(ticket.owner, outsideAgent._id.toString())
    } catch (e) {
      err = e
    }
    expect(err).to.exist
    expect(err.statusCode).to.equal(403)
    expect(ticket.assignee).to.not.exist
  })

  it('PUT /api/v2/tickets/:uid/additional-assignees rejects accounts without access', async function () {
    const res = await send('put', '/api/v2/tickets/' + ticketUid + '/additional-assignees', {
      additionalAssignees: [insideAgent._id.toString(), outsideAgent._id.toString()]
    })

    expect(res.status).to.equal(403)
    const fresh = await freshTicket()
    expect(fresh.additionalAssignees).to.have.length(0)
  })

  it('POST /api/v2/tickets rejects an assignee without access to the group', async function () {
    const res = await send('post', '/api/v2/tickets', {
      subject: 'assignee group fixture create',
      issue: 'should not be created',
      type: typeId,
      group: testGroupId,
      priority: priorityId,
      assignee: outsideAgent._id.toString()
    })

    expect(res.status).to.equal(403)
    const created = await ticketModel.findOne({ subject: 'assignee group fixture create' })
    expect(created).to.not.exist
  })

  it('allows assigning an agent whose team reaches the group', async function () {
    const res = await send('put', '/api/v2/tickets/' + ticketUid, { ticket: { assignee: insideAgent._id.toString() } })

    expect(res.status).to.equal(200)
    const fresh = await freshTicket()
    expect(fresh.assignee.toString()).to.equal(insideAgent._id.toString())

    const add = await send('put', '/api/v2/tickets/' + ticketUid + '/additional-assignees', { additionalAssignees: [] })
    expect(add.status).to.equal(200)
  })

  it('GET /api/v2/accounts?type=agents&group= only lists agents who can see the group', async function () {
    const res = await send('get', '/api/v2/accounts?type=agents&limit=-1&group=' + testGroupId)

    expect(res.status).to.equal(200)
    const ids = res.body.accounts.map(a => a._id.toString())
    expect(ids).to.include(insideAgent._id.toString())
    expect(ids).to.not.include(outsideAgent._id.toString())

    const unfiltered = await send('get', '/api/v2/accounts?type=agents&limit=-1')
    expect(unfiltered.body.accounts.map(a => a._id.toString())).to.include(outsideAgent._id.toString())
  })
})

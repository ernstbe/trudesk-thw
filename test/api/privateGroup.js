/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const teamSchema = require('../../src/models/team')
const departmentSchema = require('../../src/models/department')
const ticketModel = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')

// #privatetickets — a user's private group (created via
// POST /api/v2/accounts/me/private-group) must be visible only to its
// owner, even to an admin/agent whose department has allGroups: true
// (which otherwise sweeps in every group, see Department.getDepartmentGroupsOfUser).
// A ticket filed into the private group must be reachable by its owner and
// invisible to everyone else, until the owner "publishes" it by moving it
// into a real group via the normal group-change path.
describe('#privatetickets — private group visibility', function () {
  const baseUrl = 'http://localhost:3111'
  const ownerToken = 'private-owner-token'
  const agentToken = 'private-allgroups-agent-token'

  let owner
  let allGroupsAgent
  let team
  let department
  let publishGroup
  let privateGroupId
  let typeId
  let priorityId
  let ticketUid
  let ticketId

  before(async function () {
    const userRole = (await roleSchema.getRoles()).find(r => r.normalized === 'user')
    owner = await userSchema.create({
      username: 'privatetickets.owner',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Private Tickets Owner',
      email: 'privatetickets.owner@trudesk.io',
      role: userRole._id,
      accessToken: ownerToken
    })

    const supportRole = (await roleSchema.getRoles()).find(r => r.normalized === 'support')
    allGroupsAgent = await userSchema.create({
      username: 'privatetickets.agent',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Private Tickets AllGroups Agent',
      email: 'privatetickets.agent@trudesk.io',
      role: supportRole._id,
      accessToken: agentToken
    })

    team = await teamSchema.create({ name: 'Private Tickets AllGroups Team', members: [allGroupsAgent._id] })
    department = await departmentSchema.create({
      name: 'Private Tickets AllGroups Department',
      teams: [team._id],
      allGroups: true
    })

    // A real group the owner is a member of — the "publish" target. Moving
    // the private ticket into a group the owner cannot reach must still be
    // rejected by the normal group-move authorization check, so this must
    // NOT be the seeded TEST group (the owner isn't a member of that one).
    publishGroup = await groupSchema.create({ name: 'Private Tickets Publish Target', members: [owner._id] })

    const type = await tickettype.getTypeByName('Task')
    typeId = type._id.toString()
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    priorityId = priority._id.toString()
  })

  after(async function () {
    if (ticketId) await ticketModel.deleteOne({ _id: ticketId })
    if (privateGroupId) await groupSchema.deleteOne({ _id: privateGroupId })
    if (publishGroup) await groupSchema.deleteOne({ _id: publishGroup._id })
    if (department) await departmentSchema.deleteOne({ _id: department._id })
    if (team) await teamSchema.deleteOne({ _id: team._id })
    if (owner) await userSchema.deleteOne({ _id: owner._id })
    if (allGroupsAgent) await userSchema.deleteOne({ _id: allGroupsAgent._id })
  })

  function post (path, body, token) {
    return new Promise(function (resolve) {
      superagent
        .post(baseUrl + path)
        .set('accesstoken', token)
        .type('json')
        .send(body || {})
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  function get (path, token) {
    return new Promise(function (resolve) {
      superagent
        .get(baseUrl + path)
        .set('accesstoken', token)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  function put (path, body, token) {
    return new Promise(function (resolve) {
      superagent
        .put(baseUrl + path)
        .set('accesstoken', token)
        .type('json')
        .send(body || {})
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  it('POST /api/v2/accounts/me/private-group creates the private group idempotently', async function () {
    const res1 = await post('/api/v2/accounts/me/private-group', {}, ownerToken)
    expect(res1.status).to.equal(200)
    expect(res1.body.success).to.be.true
    expect(res1.body.group.private).to.equal(true)
    privateGroupId = res1.body.group._id

    const res2 = await post('/api/v2/accounts/me/private-group', {}, ownerToken)
    expect(res2.status).to.equal(200)
    expect(res2.body.group._id).to.equal(privateGroupId)
  })

  it('GET /api/v2/groups includes the private group for its owner', async function () {
    const res = await get('/api/v2/groups', ownerToken)
    expect(res.status).to.equal(200)
    const ids = res.body.groups.map(g => (g._id || g).toString())
    expect(ids).to.include(privateGroupId)
  })

  it('GET /api/v2/groups?type=all (admin listing) hides the private group even from its owner', async function () {
    const res = await get('/api/v2/groups?type=all', ownerToken)
    expect(res.status).to.equal(200)
    const ids = res.body.groups.map(g => (g._id || g).toString())
    expect(ids).to.not.include(privateGroupId)
  })

  it('GET /api/v2/groups does not include the private group for an allGroups:true agent', async function () {
    const res = await get('/api/v2/groups?type=all', agentToken)
    expect(res.status).to.equal(200)
    const ids = res.body.groups.map(g => (g._id || g).toString())
    expect(ids).to.not.include(privateGroupId)

    const resUser = await get('/api/v2/groups', agentToken)
    expect(resUser.status).to.equal(200)
    const userIds = resUser.body.groups.map(g => (g._id || g).toString())
    expect(userIds).to.not.include(privateGroupId)
  })

  it('POST /api/v2/tickets creates a ticket in the caller\'s own private group', async function () {
    const res = await post(
      '/api/v2/tickets',
      {
        subject: 'Private ticket',
        issue: 'Only the owner should ever see this',
        type: typeId,
        group: privateGroupId,
        priority: priorityId,
        tags: []
      },
      ownerToken
    )
    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    ticketUid = res.body.ticket.uid
    ticketId = res.body.ticket._id
  })

  it('GET /api/v2/tickets/:uid returns 403 for the allGroups:true agent', async function () {
    const res = await get('/api/v2/tickets/' + ticketUid, agentToken)
    expect(res.status).to.equal(403)
  })

  it('GET /api/v2/tickets/:uid succeeds for the owner', async function () {
    const res = await get('/api/v2/tickets/' + ticketUid, ownerToken)
    expect(res.status).to.equal(200)
    expect(res.body.ticket.uid).to.equal(ticketUid)
  })

  it('publishing: moving the ticket to a real group makes it visible to the agent', async function () {
    const moveRes = await put(
      '/api/v2/tickets/' + ticketUid,
      { ticket: { group: publishGroup._id.toString() } },
      ownerToken
    )
    expect(moveRes.status).to.equal(200)
    expect(moveRes.body.success).to.be.true

    const res = await get('/api/v2/tickets/' + ticketUid, agentToken)
    expect(res.status).to.equal(200)
    expect(res.body.ticket.uid).to.equal(ticketUid)
  })
})

// #privatetickets — same guarantees when the OWNER is an agent. Agents and
// admins resolve their visible groups through team -> department, and the
// private group belongs to no department, so every endpoint that still did
// its own Department.getDepartmentGroupsOfUser lookup (instead of going
// through resolveVisibleGroups) hid the agent's own private tickets from
// them. This is the PWA's default v1 path: list, search, single ticket.
describe('#privatetickets — agent-owned private group', function () {
  const baseUrl = 'http://localhost:3111'
  const ownerToken = 'private-agent-owner-token'
  const otherToken = 'private-agent-other-token'

  let owner
  let other
  let team
  let department
  let privateGroupId
  let ticketUid
  let ticketId

  before(async function () {
    const supportRole = (await roleSchema.getRoles()).find(r => r.normalized === 'support')
    owner = await userSchema.create({
      username: 'privatetickets.agentowner',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Private Tickets Agent Owner',
      email: 'privatetickets.agentowner@trudesk.io',
      role: supportRole._id,
      accessToken: ownerToken
    })
    other = await userSchema.create({
      username: 'privatetickets.agentother',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Private Tickets Other Agent',
      email: 'privatetickets.agentother@trudesk.io',
      role: supportRole._id,
      accessToken: otherToken
    })

    // Both agents sit in the same allGroups:true department, the widest
    // sweep there is. The private group must still be owner-only.
    team = await teamSchema.create({ name: 'Private Tickets Agent Owner Team', members: [owner._id, other._id] })
    department = await departmentSchema.create({
      name: 'Private Tickets Agent Owner Department',
      teams: [team._id],
      allGroups: true
    })

    const enableRes = await new Promise(function (resolve) {
      superagent
        .post(baseUrl + '/api/v2/accounts/me/private-group')
        .set('accesstoken', ownerToken)
        .type('json')
        .send({})
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
    privateGroupId = enableRes.body.group._id

    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    const createRes = await new Promise(function (resolve) {
      superagent
        .post(baseUrl + '/api/v1/tickets/create')
        .set('accesstoken', ownerToken)
        .type('json')
        .send({
          subject: 'Agent private ticket zebrafinch',
          issue: 'Only the agent who owns this should see it',
          type: type._id.toString(),
          group: privateGroupId,
          priority: priority._id.toString(),
          tags: []
        })
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
    const ticket = createRes.body.ticket
    ticketUid = ticket.uid
    ticketId = ticket._id
  })

  after(async function () {
    if (ticketId) await ticketModel.deleteOne({ _id: ticketId })
    if (privateGroupId) await groupSchema.deleteOne({ _id: privateGroupId })
    if (department) await departmentSchema.deleteOne({ _id: department._id })
    if (team) await teamSchema.deleteOne({ _id: team._id })
    if (owner) await userSchema.deleteOne({ _id: owner._id })
    if (other) await userSchema.deleteOne({ _id: other._id })
  })

  function get (path, token) {
    return new Promise(function (resolve) {
      superagent
        .get(baseUrl + path)
        .set('accesstoken', token)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  const uids = res => (res.body.tickets || []).map(t => t.uid)
  const groupIds = res => (res.body.groups || []).map(g => (g._id || g).toString())

  it('GET /api/v1/groups includes the private group for its agent owner', async function () {
    const res = await get('/api/v1/groups', ownerToken)
    expect(res.status).to.equal(200)
    expect(groupIds(res)).to.include(privateGroupId)
  })

  it('GET /api/v1/tickets lists the private ticket for its agent owner only', async function () {
    const mine = await get('/api/v1/tickets?limit=1000', ownerToken)
    expect(mine.status).to.equal(200)
    expect(uids(mine)).to.include(ticketUid)

    const theirs = await get('/api/v1/tickets?limit=1000', otherToken)
    expect(theirs.status).to.equal(200)
    expect(uids(theirs)).to.not.include(ticketUid)
  })

  it('GET /api/v1/tickets/search finds the private ticket for its agent owner only', async function () {
    const mine = await get('/api/v1/tickets/search?search=zebrafinch', ownerToken)
    expect(mine.status).to.equal(200)
    expect(uids(mine)).to.include(ticketUid)

    const theirs = await get('/api/v1/tickets/search?search=zebrafinch', otherToken)
    expect(uids(theirs)).to.not.include(ticketUid)
  })

  it('GET /api/v1/tickets/:uid returns the private ticket to its agent owner', async function () {
    const res = await get('/api/v1/tickets/' + ticketUid, ownerToken)
    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    expect(res.body.ticket.uid).to.equal(ticketUid)
  })

  it('GET /api/v1/tickets/:uid returns 403 to another agent', async function () {
    const res = await get('/api/v1/tickets/' + ticketUid, otherToken)
    expect(res.status).to.equal(403)
    expect(res.body.ticket).to.be.undefined
  })

  it('GET /api/v2/tickets/:uid returns the private ticket to its agent owner, 403 to others', async function () {
    const mine = await get('/api/v2/tickets/' + ticketUid, ownerToken)
    expect(mine.status).to.equal(200)
    expect(mine.body.ticket.uid).to.equal(ticketUid)

    const theirs = await get('/api/v2/tickets/' + ticketUid, otherToken)
    expect(theirs.status).to.equal(403)
  })

  it('session group lists include the private group for its agent owner only', async function () {
    const session = await get('/api/v2/login', ownerToken)
    expect(session.status).to.equal(200)
    expect(session.body.groups.map(String)).to.include(privateGroupId)

    const v1Groups = await get('/api/v1/users/privatetickets.agentowner/groups', ownerToken)
    expect(groupIds(v1Groups)).to.include(privateGroupId)

    const otherSession = await get('/api/v2/login', otherToken)
    expect(otherSession.body.groups.map(String)).to.not.include(privateGroupId)
  })
})

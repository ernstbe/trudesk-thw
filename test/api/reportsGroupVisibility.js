const expect = require('chai').expect
const superagent = require('superagent')

const groupSchema = require('../../src/models/group')
const ticketModel = require('../../src/models/ticket')
const userSchema = require('../../src/models/user')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')
const statusSchema = require('../../src/models/ticketStatus')

// Regression coverage for GH-141/GH-142: reportsApi.handover trusted an
// arbitrary req.query.groupId with no visibility check, and
// reportsApi.sitzung queried Ticket.find with no group filter at all —
// both let an agent pull ticket data (including comment text in the
// handover report) from a group outside their department mapping. Both
// now scope to resolveVisibleGroups, mirroring the gate ticketsV2.single/
// .update already apply. Uses the same seeded-admin-scoped-to-TEST-
// Department fixture as ticketUpdateGroupPermission.js: the admin sees
// TEST (via TEST Department) but not a freshly created, unmapped group.
describe('reports — group visibility enforcement', function () {
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  let testGroupId
  let forbiddenGroup
  let foreignTicketId

  before(async function () {
    const group = await groupSchema.getGroupByName('TEST')
    testGroupId = group._id.toString()

    forbiddenGroup = await groupSchema.create({ name: 'Reports Forbidden Group' })

    const owner = await userSchema.getUserByUsername('trudesk')
    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    const status = await statusSchema.findOne({ uid: 0 })

    const foreignTicket = await ticketModel.create({
      owner: owner._id,
      group: forbiddenGroup._id,
      type: type._id,
      status: status._id,
      priority: priority._id,
      subject: 'Reports visibility — foreign ticket',
      issue: 'fixture',
      comments: [{ owner: owner._id, date: new Date(), comment: 'sensitive foreign-group comment' }]
    })
    foreignTicketId = foreignTicket._id
  })

  after(async function () {
    if (foreignTicketId) await ticketModel.deleteOne({ _id: foreignTicketId })
    if (forbiddenGroup) await groupSchema.deleteOne({ _id: forbiddenGroup._id })
  })

  function get (path) {
    return new Promise(function (resolve) {
      superagent
        .get(baseUrl + path)
        .set('accesstoken', adminToken)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  it('handover: rejects a groupId outside the caller\'s department mapping', async function () {
    const res = await get('/api/v2/reports/handover?groupId=' + forbiddenGroup._id.toString())

    expect(res.status).to.equal(403)
    expect(res.body.success).to.equal(false)
  })

  it('handover: succeeds for a groupId the caller can see', async function () {
    const res = await get('/api/v2/reports/handover?groupId=' + testGroupId)

    expect(res.status).to.equal(200)
    expect(res.body.success).to.equal(true)
    expect(res.body.group).to.equal('TEST')
  })

  it('sitzung: excludes tickets from groups the caller cannot see', async function () {
    const since = new Date()
    since.setDate(since.getDate() - 30)

    const res = await get('/api/v2/reports/sitzung?since=' + since.toISOString())

    expect(res.status).to.equal(200)
    expect(res.body.success).to.equal(true)
    expect(res.body.opened).to.not.have.property('Reports Forbidden Group')
  })
})

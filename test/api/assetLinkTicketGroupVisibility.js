/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

const Asset = require('../../src/models/asset')
const groupSchema = require('../../src/models/group')
const ticketModel = require('../../src/models/ticket')
const userSchema = require('../../src/models/user')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')
const statusSchema = require('../../src/models/ticketStatus')

// Regression coverage for GH-143: assetsApi.linkTicket loaded the ticket via
// getTicketByUid with no group check and wrote metadata.assetId/assetTag/
// assetName + updated straight onto it, letting an agent link (and thereby
// write into) a ticket outside their visible groups. Uses the same seeded-
// admin-scoped-to-TEST-Department fixture as reportsGroupVisibility.js: the
// admin sees TEST (via TEST Department) but not a freshly created, unmapped
// group.
describe('assets.linkTicket — group visibility enforcement', function () {
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  let forbiddenGroup
  let foreignTicketId
  let foreignTicketUid
  let assetId

  before(async function () {
    forbiddenGroup = await groupSchema.create({ name: 'Asset Link Forbidden Group' })

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
      subject: 'Asset link visibility — foreign ticket',
      issue: 'fixture'
    })
    foreignTicketId = foreignTicket._id
    foreignTicketUid = foreignTicket.uid

    const asset = await Asset.create({ name: 'Test Asset', assetTag: 'THW-FZ-VISIBILITY-001' })
    assetId = asset._id
  })

  after(async function () {
    if (assetId) await Asset.deleteOne({ _id: assetId })
    if (foreignTicketId) await ticketModel.deleteOne({ _id: foreignTicketId })
    if (forbiddenGroup) await groupSchema.deleteOne({ _id: forbiddenGroup._id })
  })

  function post (path, body) {
    return new Promise(function (resolve) {
      superagent
        .post(baseUrl + path)
        .set('accesstoken', adminToken)
        .type('json')
        .send(body)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  it('rejects linking a ticket in a group outside the caller\'s department mapping', async function () {
    const res = await post('/api/v2/assets/' + assetId.toString() + '/link-ticket', { ticketUid: foreignTicketUid })

    expect(res.status).to.equal(403)
    expect(res.body.success).to.equal(false)

    const fresh = await ticketModel.findOne({ _id: foreignTicketId })
    expect(fresh.metadata && fresh.metadata.assetId).to.not.exist
  })
})

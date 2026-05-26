const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')
const settingSchema = require('../../src/models/setting')
const ticketSchema = require('../../src/models/ticket')

// Regression coverage for the v1 IDOR where any caller could overwrite
// the ticket owner by setting `owner` in the request body — the handler
// trusted whatever the client sent. The override is now gated on
// (a) the caller being admin/agent and
// (b) the `allowAgentUserTickets:enable` setting being on
// — the same setting the React CreateTicketModal uses to show the owner
// dropdown. Anyone else is force-assigned `req.user._id`.
//
// v2 already hard-pinned owner to req.user._id (no override path), so
// this suite targets v1 only.
describe('POST /api/v1/tickets/create — owner override gating', function () {
  const baseUrl = 'http://localhost:3111'
  const customerToken = 'owner-override-customer-token'
  let customerUser
  let targetUser
  let testGroupId
  let typeId
  let priorityId

  async function setSetting (value) {
    await settingSchema.deleteMany({ name: 'allowAgentUserTickets:enable' })
    if (value !== null) {
      await settingSchema.create({ name: 'allowAgentUserTickets:enable', value })
    }
  }

  before(async function () {
    const userRole = (await roleSchema.getRoles()).find(r => r.normalized === 'user')
    customerUser = await userSchema.create({
      username: 'owner.override.customer',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Owner Override Customer',
      email: 'owner.override.customer@trudesk.io',
      role: userRole._id,
      accessToken: customerToken
    })

    // Put the customer into TEST so the group-permission check (PR #97)
    // doesn't 403 first and mask the owner check. addMember only mutates
    // the in-memory doc — persist the change so getAllGroupsOfUser sees it.
    const group = await groupSchema.getGroupByName('TEST')
    if (!group.isMember(customerUser._id)) {
      await group.addMember(customerUser._id)
      await group.save()
    }
    testGroupId = group._id.toString()

    targetUser = await userSchema.getUserByUsername('fake.user')

    const type = await tickettype.getTypeByName('Task')
    typeId = type._id.toString()
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    priorityId = priority._id.toString()
  })

  after(async function () {
    await setSetting(null)
    // Drop everything this suite created so downstream tests see a
    // clean ticket list (api/tickets.js, ticketsV2.js, etc.).
    await ticketSchema.deleteMany({ subject: 'Owner override test' })
    if (customerUser) {
      const group = await groupSchema.getGroupByName('TEST')
      if (group.isMember(customerUser._id)) {
        await group.removeMember(customerUser._id)
        await group.save()
      }
      await userSchema.deleteOne({ _id: customerUser._id })
    }
  })

  function postCreate (token, body) {
    return superagent
      .post(baseUrl + '/api/v1/tickets/create')
      .set('accesstoken', token)
      .type('json')
      .send(body)
  }

  function basePayload (extra) {
    return Object.assign({
      subject: 'Owner override test',
      issue: 'body',
      type: typeId,
      group: testGroupId,
      priority: priorityId,
      tags: []
    }, extra || {})
  }

  it('customer overriding owner is rejected even when the setting is enabled', async function () {
    await setSetting(true)
    try {
      await postCreate(customerToken, basePayload({ owner: targetUser._id.toString() }))
      throw new Error('expected 403 but request succeeded')
    } catch (err) {
      expect(err.status).to.equal(403)
      expect(err.response.body.error).to.match(/owner override/i)
    }
  })

  it('admin overriding owner is rejected when the setting is disabled', async function () {
    await setSetting(false)
    const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    try {
      await postCreate(adminToken, basePayload({ owner: targetUser._id.toString() }))
      throw new Error('expected 403 but request succeeded')
    } catch (err) {
      expect(err.status).to.equal(403)
      expect(err.response.body.error).to.match(/owner override/i)
    }
  })

  it('admin overriding owner succeeds when the setting is enabled', async function () {
    await setSetting(true)
    const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    const res = await postCreate(adminToken, basePayload({ owner: targetUser._id.toString() }))
    expect(res.status).to.equal(200)
    expect(res.body.success).to.equal(true)
    // populate('owner') returns the full account doc — match by _id.
    const ownerId = res.body.ticket.owner && (res.body.ticket.owner._id || res.body.ticket.owner)
    expect(ownerId.toString()).to.equal(targetUser._id.toString())
  })

  it('customer without an owner field is self-assigned (unchanged behaviour)', async function () {
    await setSetting(false)
    const res = await postCreate(customerToken, basePayload())
    expect(res.status).to.equal(200)
    const ownerId = res.body.ticket.owner && (res.body.ticket.owner._id || res.body.ticket.owner)
    expect(ownerId.toString()).to.equal(customerUser._id.toString())
  })
})

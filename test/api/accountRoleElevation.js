const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const GroupSchema = require('../../src/models/group')
const ticketSchema = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')

// PWA bug-report #3: when a Customer is elevated to Support (Agent/Admin)
// the personal group createPublicAccount auto-created at signup is now
// orphaned — the user no longer reaches it through their Team→Department
// chain, and the admin UI shows an empty public group named after their
// email. accountsApi.update used to only strip the user's membership;
// it now also deletes the group when it is unambiguously the personal
// one (single member = the user being elevated, sendMailTo at most this
// user, public: true, no tickets ever referenced it).
describe('PUT /api/v2/accounts/:username — personal-group auto-delete on elevation', function () {
  const baseUrl = 'http://localhost:3111'
  // Same admin token the other suites use (see ticketCreateOwnerOverride).
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
  let userRoleId
  let adminRoleId

  before(async function () {
    const roles = await roleSchema.getRoles()
    userRoleId = roles.find(r => r.normalized === 'user')._id
    adminRoleId = roles.find(r => r.normalized === 'admin')._id
  })

  async function createCustomerWithPersonalGroup (username, email) {
    const customer = await userSchema.create({
      username,
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: username,
      email,
      role: userRoleId
    })
    // Mirror what createPublicAccount does on signup.
    const group = new GroupSchema({
      name: email,
      members: [customer._id],
      sendMailTo: [customer._id],
      public: true
    })
    await group.save()
    return { customer, group }
  }

  async function deleteIfExists (model, query) {
    try { await model.deleteOne(query) } catch (_) { /* already gone */ }
  }

  it('deletes the orphaned personal group on elevation when it has no tickets', async function () {
    const { customer, group } = await createCustomerWithPersonalGroup(
      'elevation.empty', 'elevation.empty@trudesk.io'
    )
    try {
      const res = await superagent
        .put(baseUrl + '/api/v2/accounts/' + customer.username)
        .set('accesstoken', adminToken)
        .type('json')
        .send({ role: adminRoleId.toString() })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.equal(true)

      const stillThere = await GroupSchema.findById(group._id)
      expect(stillThere, 'expected the personal group to be deleted').to.equal(null)
    } finally {
      await deleteIfExists(GroupSchema, { _id: group._id })
      await deleteIfExists(userSchema, { _id: customer._id })
    }
  })

  it('keeps the personal group on elevation when it still has tickets', async function () {
    const { customer, group } = await createCustomerWithPersonalGroup(
      'elevation.kept', 'elevation.kept@trudesk.io'
    )
    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    const status = await require('../../src/helpers/defaultTicketStatus').resolveDefaultTicketStatus()
    const ticket = await ticketSchema.create({
      owner: customer._id,
      group: group._id,
      type: type._id,
      priority: priority._id,
      status: status._id,
      subject: 'Keep my group alive',
      issue: 'has a ticket referencing the personal group'
    })
    try {
      const res = await superagent
        .put(baseUrl + '/api/v2/accounts/' + customer.username)
        .set('accesstoken', adminToken)
        .type('json')
        .send({ role: adminRoleId.toString() })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.equal(true)

      const stillThere = await GroupSchema.findById(group._id)
      expect(stillThere, 'expected the personal group to survive because a ticket references it').to.not.equal(null)
      // Membership was still stripped — same invariant the stripAgentsFromGroups
      // boot migration enforces.
      expect(stillThere.members.find(m => String(m._id) === String(customer._id))).to.equal(undefined)
    } finally {
      await deleteIfExists(ticketSchema, { _id: ticket._id })
      await deleteIfExists(GroupSchema, { _id: group._id })
      await deleteIfExists(userSchema, { _id: customer._id })
    }
  })

  it('does not touch shared groups (more than one member) on elevation', async function () {
    const { customer, group } = await createCustomerWithPersonalGroup(
      'elevation.shared', 'elevation.shared@trudesk.io'
    )
    // Add a second member so this is no longer a single-member personal group.
    const second = await userSchema.create({
      username: 'elevation.shared.peer',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Elevation Shared Peer',
      email: 'elevation.shared.peer@trudesk.io',
      role: userRoleId
    })
    await group.addMember(second._id)
    await group.save()
    try {
      const res = await superagent
        .put(baseUrl + '/api/v2/accounts/' + customer.username)
        .set('accesstoken', adminToken)
        .type('json')
        .send({ role: adminRoleId.toString() })
      expect(res.status).to.equal(200)

      const stillThere = await GroupSchema.findById(group._id)
      expect(stillThere, 'shared group must survive').to.not.equal(null)
      expect(stillThere.members.find(m => String(m._id) === String(second._id)), 'peer member must remain').to.not.equal(undefined)
      expect(stillThere.members.find(m => String(m._id) === String(customer._id)), 'elevated user must be stripped').to.equal(undefined)
    } finally {
      await deleteIfExists(GroupSchema, { _id: group._id })
      await deleteIfExists(userSchema, { _id: customer._id })
      await deleteIfExists(userSchema, { _id: second._id })
    }
  })
})

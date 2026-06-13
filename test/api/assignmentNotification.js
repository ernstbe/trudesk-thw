const expect = require('chai').expect
const request = require('supertest')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const ticketSchema = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')
const notificationSchema = require('../../src/models/notification')

// Assigning a ticket to a user should create an in-app notification for that
// user (which also fires web push) — except when assigning to yourself.
describe('assignment notifications (PUT /api/v1/tickets/:id assignee)', function () {
  const api = request('http://localhost:3111')
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  let adminUser
  let assignee
  let ticketId
  let ticketUid

  before(async function () {
    const roles = await roleSchema.getRoles()
    const userRoleId = roles.find(r => r.normalized === 'user')._id
    adminUser = await userSchema.getUserByUsername('trudesk')

    assignee = await userSchema.create({
      username: 'assign.target',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Assign Target',
      email: 'assign.target@trudesk.io',
      role: userRoleId
    })

    const group = await groupSchema.getGroupByName('TEST')
    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    const status = await require('../../src/helpers/defaultTicketStatus').resolveDefaultTicketStatus()

    const ticket = await ticketSchema.create({
      owner: adminUser._id,
      group: group._id,
      type: type._id,
      priority: priority._id,
      status: status._id,
      subject: 'Assignment notification test',
      issue: 'Body'
    })
    ticketId = ticket._id.toString()
    ticketUid = ticket.uid
  })

  after(async function () {
    try { await ticketSchema.deleteOne({ _id: ticketId }) } catch (_) { /* gone */ }
    try { await notificationSchema.deleteMany({ owner: assignee._id }) } catch (_) { /* gone */ }
    try { await userSchema.deleteOne({ _id: assignee._id }) } catch (_) { /* gone */ }
  })

  it('notifies the newly assigned user', async function () {
    const res = await api
      .put('/api/v1/tickets/' + ticketId)
      .set('accesstoken', adminToken)
      .set('Content-Type', 'application/json')
      .send({ assignee: assignee._id.toString() })
    expect(res.status).to.equal(200)

    const notes = await notificationSchema.find({ owner: assignee._id })
    expect(notes.length).to.be.at.least(1)
    const note = notes[notes.length - 1]
    expect(note.title).to.contain('#' + ticketUid)
    expect(note.data.ticket.uid).to.equal(ticketUid)
  })

  it('does not notify on self-assignment', async function () {
    const before = await notificationSchema.countDocuments({ owner: adminUser._id })
    const res = await api
      .put('/api/v1/tickets/' + ticketId)
      .set('accesstoken', adminToken)
      .set('Content-Type', 'application/json')
      .send({ assignee: adminUser._id.toString() })
    expect(res.status).to.equal(200)

    const after = await notificationSchema.countDocuments({ owner: adminUser._id })
    expect(after).to.equal(before)
  })
})

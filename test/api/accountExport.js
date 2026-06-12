/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const ticketSchema = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')

// DSGVO Art. 15 export — GET /api/v2/accounts/me/export
// The endpoint must return ONLY the authenticated user's data:
// own tickets, own comments/notes/attachments (also from other users'
// tickets), and a profile without any credential fields.
describe('GET /api/v2/accounts/me/export (DSGVO)', function () {
  const baseUrl = 'http://localhost:3111'
  // Admin access token seeded by 0_database.js — authenticates as 'trudesk'.
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  let adminUser
  let otherUser
  let ownTicket
  let foreignTicket

  before(async function () {
    const roles = await roleSchema.getRoles()
    const userRoleId = roles.find(r => r.normalized === 'user')._id

    adminUser = await userSchema.getUserByUsername('trudesk')

    otherUser = await userSchema.create({
      username: 'export.other',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Export Other',
      email: 'export.other@trudesk.io',
      role: userRoleId
    })

    const group = await groupSchema.getGroupByName('TEST')
    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    const status = await require('../../src/helpers/defaultTicketStatus').resolveDefaultTicketStatus()

    // Ticket owned by the exporting user (admin).
    ownTicket = await ticketSchema.create({
      owner: adminUser._id,
      group: group._id,
      type: type._id,
      priority: priority._id,
      status: status._id,
      subject: 'DSGVO export own ticket',
      issue: 'Issue text of the own ticket',
      dueDate: new Date('2030-01-15T12:00:00Z'),
      checklist: [{ title: 'Export checklist item', completed: false }]
    })

    // Ticket owned by SOMEONE ELSE — must NOT show up in the admin's
    // tickets list, but the admin's comment/note/attachment on it MUST.
    foreignTicket = await ticketSchema.create({
      owner: otherUser._id,
      group: group._id,
      type: type._id,
      priority: priority._id,
      status: status._id,
      subject: 'DSGVO export foreign ticket',
      issue: 'Issue text of the foreign ticket'
    })

    foreignTicket.comments.push({
      owner: adminUser._id,
      date: new Date(),
      comment: 'Admin comment on a foreign ticket'
    })
    foreignTicket.comments.push({
      owner: otherUser._id,
      date: new Date(),
      comment: 'Other users own comment - must not be exported by admin'
    })
    foreignTicket.notes.push({
      owner: adminUser._id,
      date: new Date(),
      note: 'Admin note on a foreign ticket'
    })
    foreignTicket.attachments.push({
      owner: adminUser._id,
      name: 'admin-upload.jpg',
      date: new Date(),
      path: '/uploads/tickets/test/admin-upload.jpg',
      type: 'image/jpeg'
    })
    await foreignTicket.save()
  })

  after(async function () {
    try { await ticketSchema.deleteOne({ _id: ownTicket._id }) } catch (_) { /* already gone */ }
    try { await ticketSchema.deleteOne({ _id: foreignTicket._id }) } catch (_) { /* already gone */ }
    try { await userSchema.deleteOne({ _id: otherUser._id }) } catch (_) { /* already gone */ }
  })

  function getExport (token) {
    return new Promise(function (resolve) {
      const req = superagent.get(baseUrl + '/api/v2/accounts/me/export')
      if (token) req.set('accesstoken', token)
      req.ok(function () { return true }).end(function (err, res) {
        resolve(err ? { status: (err && err.status) || 0, body: {}, headers: {} } : res)
      })
    })
  }

  it('returns 401 without authentication', async function () {
    const res = await getExport(null)
    expect(res.status).to.equal(401)
  })

  it('sets a download Content-Disposition header with username and date', async function () {
    const res = await getExport(adminToken)
    expect(res.status).to.equal(200)
    expect(res.headers['content-disposition']).to.match(
      /^attachment; filename="datenexport-trudesk-\d{4}-\d{2}-\d{2}\.json"$/
    )
  })

  it('contains the profile with role name and no credential fields', async function () {
    const res = await getExport(adminToken)
    expect(res.status).to.equal(200)
    expect(res.body.profile).to.be.a('object')
    expect(res.body.profile.username).to.equal('trudesk')
    expect(res.body.profile.email).to.be.a('string')
    expect(res.body.profile.role).to.be.a('string')
    expect(res.body.profile.createdAt).to.exist

    const raw = JSON.stringify(res.body)
    expect(raw).to.not.contain('password')
    expect(raw).to.not.contain('accessToken')
    expect(raw).to.not.contain('tOTPKey')
    expect(raw).to.not.contain('resetPassHash')
  })

  it('contains own tickets with resolved names, but no foreign tickets', async function () {
    const res = await getExport(adminToken)
    expect(res.status).to.equal(200)
    expect(res.body.tickets).to.be.a('array')

    const own = res.body.tickets.find(t => t.uid === ownTicket.uid)
    expect(own, 'own ticket missing from export').to.exist
    expect(own.subject).to.equal('DSGVO export own ticket')
    expect(own.status).to.be.a('string')
    expect(own.type).to.equal('Task')
    expect(own.priority).to.be.a('string')
    expect(own.group).to.equal('TEST')
    expect(own.dueDate).to.exist
    expect(own.checklist).to.deep.include({ title: 'Export checklist item', completed: false, completedAt: null })

    const foreign = res.body.tickets.find(t => t.uid === foreignTicket.uid)
    expect(foreign, 'foreign ticket must not be exported').to.not.exist
  })

  it('contains own comments/notes/attachments from foreign tickets with context, but not foreign comments', async function () {
    const res = await getExport(adminToken)
    expect(res.status).to.equal(200)

    const comment = res.body.comments.find(c => c.ticketUid === foreignTicket.uid)
    expect(comment, 'own comment on foreign ticket missing').to.exist
    expect(comment.ticketSubject).to.equal('DSGVO export foreign ticket')
    expect(comment.comment).to.equal('Admin comment on a foreign ticket')

    const raw = JSON.stringify(res.body)
    expect(raw).to.not.contain('Other users own comment')

    const note = res.body.notes.find(n => n.ticketUid === foreignTicket.uid)
    expect(note, 'own note on foreign ticket missing').to.exist
    expect(note.note).to.equal('Admin note on a foreign ticket')

    const attachment = res.body.attachments.find(a => a.ticketUid === foreignTicket.uid)
    expect(attachment, 'own attachment metadata missing').to.exist
    expect(attachment.filename).to.equal('admin-upload.jpg')
    expect(attachment.date).to.exist
    // Only metadata — never the storage path.
    expect(attachment.path).to.not.exist
  })
})

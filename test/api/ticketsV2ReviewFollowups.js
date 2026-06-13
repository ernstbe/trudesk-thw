/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

// Covers the backend-review follow-up fixes on the v2 tickets controller:
//   - batchUpdate now routes status changes through ticket.setStatus(), so the
//     closedDate is set when moving to a resolved status and cleared when
//     reopening.
//   - postNote mirrors postComment: sanitizeHtml + newline conversion.
//   - postNote / postComment ignore body.ownerId (author spoofing) and always
//     record the authenticated user as owner (doc + history entry).
describe('api/v2/tickets review follow-ups', function () {
  const agent = superagent.agent()
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  const ticketModel = require('../../src/models/ticket')
  const groupSchema = require('../../src/models/group')
  const userSchema = require('../../src/models/user')
  const statusSchema = require('../../src/models/ticketStatus')
  const prioritySchema = require('../../src/models/ticketpriority')
  const tickettype = require('../../src/models/tickettype')
  const roleSchema = require('../../src/models/role')

  let ticketUid
  let ticketId
  let groupId
  let otherUser

  before(async function () {
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

    // A second user whose _id we will try (and fail) to spoof as note/comment owner.
    const adminRole = (await roleSchema.getRoles()).find(r => r.normalized === 'admin')
    otherUser = await userSchema.create({
      username: 'v2followups.other',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'V2 Followups Other',
      email: 'v2followups.other@trudesk.io',
      role: adminRole._id,
      accessToken: 'v2followups-other-token'
    })

    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})

    const res = await new Promise(function (resolve, reject) {
      superagent
        .post(baseUrl + '/api/v1/tickets/create')
        .set('accesstoken', adminToken)
        .type('json')
        .send({
          subject: 'v2 followups fixture ticket',
          issue: 'Fixture used by the v2 review-followup tests',
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
    if (otherUser) await userSchema.deleteOne({ _id: otherUser._id })
  })

  function send (method, path, body, token) {
    return new Promise(function (resolve) {
      let request = agent[method](baseUrl + path)
      if (token) request = superagent[method](baseUrl + path).set('accesstoken', token)
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

  it('batchUpdate routes status through setStatus (sets closedDate on resolve)', async function () {
    const closed = await statusSchema.findOne({ name: 'Closed' })
    expect(closed).to.exist
    expect(closed.isResolved).to.equal(true)

    const res = await send('put', '/api/v2/tickets/batch', {
      batch: [{ id: ticketId.toString(), status: closed._id.toString() }]
    })
    expect(res.status).to.equal(200)
    // NB: batchUpdate merges its result counters onto the { success: true }
    // envelope, so the numeric success/failed counts land at the top level.
    expect(res.body.success).to.equal(1)
    expect(res.body.failed).to.equal(0)

    const fresh = await freshTicket()
    expect(fresh.status.toString()).to.equal(closed._id.toString())
    expect(fresh.closedDate).to.exist
    // setStatus writes a named status-history entry
    expect(fresh.history.some(h => h.action === 'ticket:set:status:Closed')).to.be.true
  })

  it('batchUpdate clears closedDate when reopening to a non-resolved status', async function () {
    const open = await statusSchema.findOne({ name: 'Open' })
    const res = await send('put', '/api/v2/tickets/batch', {
      batch: [{ id: ticketId.toString(), status: open._id.toString() }]
    })
    expect(res.status).to.equal(200)
    expect(res.body.success).to.equal(1)
    expect(res.body.failed).to.equal(0)

    const fresh = await freshTicket()
    expect(fresh.status.toString()).to.equal(open._id.toString())
    expect(fresh.closedDate === null || fresh.closedDate === undefined).to.be.true
  })

  it('postNote sanitizes HTML and converts newlines', async function () {
    const res = await send('post', '/api/v2/tickets/' + ticketUid + '/notes', {
      note: 'line one\nline two<script>alert(1)</script>'
    })
    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true

    const fresh = await freshTicket()
    const lastNote = fresh.notes[fresh.notes.length - 1]
    expect(lastNote.note).to.contain('<br')
    expect(lastNote.note).to.not.contain('<script>')
  })

  it('postNote ignores body.ownerId and records the authenticated user', async function () {
    const res = await send('post', '/api/v2/tickets/' + ticketUid + '/notes', {
      note: 'spoof attempt note',
      ownerId: otherUser._id.toString()
    })
    expect(res.status).to.equal(200)

    const fresh = await freshTicket()
    const lastNote = fresh.notes[fresh.notes.length - 1]
    const noteOwner = (lastNote.owner._id || lastNote.owner).toString()
    expect(noteOwner).to.not.equal(otherUser._id.toString())

    const lastNoteHistory = [...fresh.history].reverse().find(h => h.action === 'ticket:note:added')
    expect(lastNoteHistory).to.exist
    expect((lastNoteHistory.owner._id || lastNoteHistory.owner).toString()).to.not.equal(otherUser._id.toString())
  })

  it('postComment ignores body.ownerId and records the authenticated user', async function () {
    const res = await send('post', '/api/v2/tickets/' + ticketUid + '/comments', {
      comment: 'spoof attempt comment',
      ownerId: otherUser._id.toString()
    })
    expect(res.status).to.equal(200)

    const fresh = await freshTicket()
    const lastComment = fresh.comments[fresh.comments.length - 1]
    const commentOwner = (lastComment.owner._id || lastComment.owner).toString()
    expect(commentOwner).to.not.equal(otherUser._id.toString())

    const lastCommentHistory = [...fresh.history].reverse().find(h => h.action === 'ticket:comment:added')
    expect(lastCommentHistory).to.exist
    expect((lastCommentHistory.owner._id || lastCommentHistory.owner).toString()).to.not.equal(otherUser._id.toString())
  })
})

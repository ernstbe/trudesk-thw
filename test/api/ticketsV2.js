/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

// Covers the endpoints added to api/v2/tickets.js and api/v2/users.js
// in the R3.3 v1->v2 migration:
//   POST   /api/v2/tickets/:uid/comments
//   POST   /api/v2/tickets/:uid/notes
//   PUT    /api/v2/tickets/:uid/subscribe
//   GET    /api/v2/tickets/stats(/:timespan)
//   GET    /api/v2/tickets/stats/group/:group
//   GET    /api/v2/tickets/stats/user/:user
//   GET    /api/v2/tickets/stats/assignee/:user
//   DELETE /api/v2/tickets/batch
//   GET    /api/v2/users/notifications
//   GET    /api/v2/users/notifications/count
//
// Uses the same session-cookie pattern as the other v2 test files
// (see test/api/recurringTasks.js) because apiv2Auth is session-based;
// the accesstoken header only authenticates the v1 API.
describe('api/v2/tickets + users (R3.3)', function () {
  const agent = superagent.agent()
  const baseUrl = 'http://localhost:3111'
  let ticketId
  let ticketUid
  let groupId
  let adminUserId

  before(async function () {
    // Session login — same credentials 0_database.js seeds.
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

    const groupSchema = require('../../src/models/group')
    const userSchema = require('../../src/models/user')
    const tickettype = require('../../src/models/tickettype')
    const prioritySchema = require('../../src/models/ticketpriority')

    const user = await userSchema.getUserByUsername('trudesk')
    adminUserId = user._id.toString()
    const group = await groupSchema.getGroupByName('TEST')
    groupId = group._id.toString()
    if (!group.isMember(user._id)) {
      await group.addMember(user._id)
    }
    // NOTE: the global test bootstrap (test/0_database.js) already wires this
    // admin into a team -> department -> TEST-group chain, so the stats
    // endpoints below (which scope to the caller's department groups, the same
    // Jugend/Stab gate the ticket list uses) can see the fixture group.

    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})

    // Create a ticket through the v1 endpoint with the admin access token.
    // v2 create is stubbed today, and this file only cares about exercising
    // the new v2 read/write endpoints against an existing ticket.
    const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    const res = await new Promise(function (resolve, reject) {
      superagent
        .post(baseUrl + '/api/v1/tickets/create')
        .set('accesstoken', adminToken)
        .type('json')
        .send({
          subject: 'R3.3 fixture ticket',
          issue: 'Fixture used by v2 migration tests',
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
    ticketId = res.body.ticket._id
    ticketUid = res.body.ticket.uid
  })

  function post (path, body) {
    return new Promise(function (resolve) {
      agent
        .post(baseUrl + path)
        .type('json')
        .send(body || {})
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  function put (path, body) {
    return new Promise(function (resolve) {
      agent
        .put(baseUrl + path)
        .type('json')
        .send(body || {})
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  function get (path) {
    return new Promise(function (resolve) {
      agent
        .get(baseUrl + path)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  function del (path, body) {
    return new Promise(function (resolve) {
      agent
        .delete(baseUrl + path)
        .type('json')
        .send(body || {})
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  // ------------------------------------------------------------------
  // Comments
  // ------------------------------------------------------------------
  describe('POST /api/v2/tickets/:uid/comments', function () {
    it('adds a comment to an existing ticket', async function () {
      const res = await post('/api/v2/tickets/' + ticketUid + '/comments', { comment: 'R3.3 test comment' })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.ticket).to.be.a('object')
      expect(res.body.ticket.comments.length).to.be.at.least(1)
    })

    it('preserves blank lines between paragraphs', async function () {
      const res = await post('/api/v2/tickets/' + ticketUid + '/comments', { comment: 'line one\n\n\nline two' })
      expect(res.status).to.equal(200)
      const added = res.body.ticket.comments[res.body.ticket.comments.length - 1]
      // Newlines become <br> so marked cannot collapse the blank lines away.
      expect(added.comment).to.match(/line one(<br\s*\/?>\s*){3}line two/)
    })

    it('rejects a request without a comment body', async function () {
      const res = await post('/api/v2/tickets/' + ticketUid + '/comments', {})
      expect(res.status).to.equal(400)
    })

    it('returns 404 for an unknown ticket uid', async function () {
      const res = await post('/api/v2/tickets/999999/comments', { comment: 'no target' })
      expect(res.status).to.equal(404)
    })
  })

  // ------------------------------------------------------------------
  // Notes
  // ------------------------------------------------------------------
  describe('POST /api/v2/tickets/:uid/notes', function () {
    it('adds an internal note', async function () {
      const res = await post('/api/v2/tickets/' + ticketUid + '/notes', { note: 'R3.3 test note' })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.ticket.notes.length).to.be.at.least(1)
    })

    it('rejects a request without a note body', async function () {
      const res = await post('/api/v2/tickets/' + ticketUid + '/notes', {})
      expect(res.status).to.equal(400)
    })
  })

  // ------------------------------------------------------------------
  // Subscribe
  // ------------------------------------------------------------------
  describe('PUT /api/v2/tickets/:uid/subscribe', function () {
    function subscriberIds (ticket) {
      // Subscribers may come back populated ({_id, fullname, …}) or as raw id strings
      // depending on what the mongoose layer did on .save(). Normalize both shapes.
      return (ticket.subscribers || []).map(function (s) {
        if (s === null || s === undefined) return ''
        if (typeof s === 'string') return s
        if (s._id) return s._id.toString()
        return s.toString()
      })
    }

    it('subscribes the authenticated user', async function () {
      const res = await put('/api/v2/tickets/' + ticketUid + '/subscribe', { subscribe: true })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(subscriberIds(res.body.ticket)).to.include(adminUserId)
    })

    it('unsubscribes the authenticated user', async function () {
      const res = await put('/api/v2/tickets/' + ticketUid + '/subscribe', { subscribe: false })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(subscriberIds(res.body.ticket)).to.not.include(adminUserId)
    })

    it('rejects a request without subscribe flag', async function () {
      const res = await put('/api/v2/tickets/' + ticketUid + '/subscribe', {})
      expect(res.status).to.equal(400)
    })
  })

  // ------------------------------------------------------------------
  // Stats
  // ------------------------------------------------------------------
  describe('GET /api/v2/tickets/stats*', function () {
    it('rejects an invalid timespan', async function () {
      const res = await get('/api/v2/tickets/stats/7')
      // The global cache may be absent in the test harness; we accept
      // either a 400 (invalid timespan) or a 503 (cache still loading).
      expect([400, 503]).to.include(res.status)
    })

    it('returns group stats for the fixture group', async function () {
      const res = await get('/api/v2/tickets/stats/group/' + groupId)
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.ticketCount).to.be.at.least(1)
    })

    it('returns user stats for the admin user', async function () {
      const res = await get('/api/v2/tickets/stats/user/' + adminUserId)
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.ticketCount).to.be.at.least(1)
    })

    it('returns assignee stats with zero counts when user has no assigned tickets', async function () {
      // adminUserId is the requester of the fixture ticket, not the assignee,
      // so this exercises the "no rows" path and confirms the endpoint still
      // returns 200 (unlike /stats/user/:user which 404s on empty).
      const res = await get('/api/v2/tickets/stats/assignee/' + adminUserId)
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.ticketCount).to.equal(0)
      expect(res.body.closedCount).to.equal(0)
      expect(res.body.avgResponse).to.equal(0)
    })

    it('returns a group-scoped workload array', async function () {
      const res = await get('/api/v2/tickets/stats/workload')
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.workload).to.be.a('array')
      // Fixture ticket is unassigned, so no assignee rows are produced.
      expect(res.body.workload).to.have.lengthOf(0)
    })

    it('forbids group stats for a group the caller cannot see', async function () {
      // A group id the fixture user is not a member of (and which is not in
      // any of their departments) must be rejected before any data is read.
      const mongoose = require('mongoose')
      const unseenGroupId = new mongoose.Types.ObjectId().toString()
      const res = await get('/api/v2/tickets/stats/group/' + unseenGroupId)
      expect(res.status).to.equal(403)
    })
  })

  // ------------------------------------------------------------------
  // Users / notifications (v2)
  // ------------------------------------------------------------------
  describe('GET /api/v2/users/notifications*', function () {
    it('returns a (possibly empty) notification list for the caller', async function () {
      const res = await get('/api/v2/users/notifications')
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.notifications).to.be.a('array')
    })

    it('returns an unread count', async function () {
      const res = await get('/api/v2/users/notifications/count')
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.count).to.exist
    })
  })

  // ------------------------------------------------------------------
  // Attachment upload — POST /api/v2/tickets/:tid/attachments
  // ------------------------------------------------------------------
  describe('POST /api/v2/tickets/:tid/attachments', function () {
    // 1x1 transparent PNG — small enough to keep the test fast, big enough
    // to exercise the sharp resize path (the image is below the 2400px
    // threshold so sharp passes it through, but still converts to JPEG).
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGD4DwABBAEAfb' +
      'rDwgAAAABJRU5ErkJggg==',
      'base64'
    )

    function uploadAttachment (path, buf, filename, mime) {
      return new Promise(function (resolve) {
        agent
          .post(baseUrl + path)
          .attach('file', buf, { filename, contentType: mime })
          .ok(function () { return true })
          .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
      })
    }

    it('rejects an upload with no file in the body', async function () {
      const res = await post('/api/v2/tickets/' + ticketId + '/attachments', {})
      expect(res.status).to.equal(400)
    })

    it('rejects an upload with a disallowed mime/extension', async function () {
      const res = await uploadAttachment(
        '/api/v2/tickets/' + ticketId + '/attachments',
        Buffer.from('<script>alert(1)</script>'),
        'evil.html',
        'text/html'
      )
      expect(res.status).to.equal(400)
    })

    it('stores a PNG, resizes it to JPEG, and appends to ticket.attachments', async function () {
      const res = await uploadAttachment(
        '/api/v2/tickets/' + ticketId + '/attachments',
        onePxPng,
        'pixel.png',
        'image/png'
      )
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.attachment).to.be.a('object')
      // sharp converts to JPEG, so the stored attachment must reflect that.
      expect(res.body.attachment.type).to.equal('image/jpeg')
      expect(res.body.attachment.name).to.match(/\.jpg$/)
      // size is set on the stored buffer length so clients can render
      // a "324 KB" badge without a second HEAD request.
      expect(res.body.attachment.size).to.be.a('number').and.greaterThan(0)
      expect(res.body.ticket.attachments.length).to.be.at.least(1)
    })

    it('returns 404 for an unknown ticket id', async function () {
      // Valid-looking but non-existing ObjectId
      const fakeId = '000000000000000000000000'
      const res = await uploadAttachment(
        '/api/v2/tickets/' + fakeId + '/attachments',
        onePxPng,
        'pixel.png',
        'image/png'
      )
      expect(res.status).to.equal(404)
    })
  })

  // ------------------------------------------------------------------
  // Batch delete — last so it doesn't affect the other tests' fixture
  // ------------------------------------------------------------------
  describe('DELETE /api/v2/tickets/batch', function () {
    it('rejects a request without an ids array', async function () {
      const res = await del('/api/v2/tickets/batch', {})
      expect(res.status).to.equal(400)
    })

    it('soft-deletes a list of ticket ids', async function () {
      const res = await del('/api/v2/tickets/batch', { ids: [ticketId] })
      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.deleted).to.equal(1)
      expect(res.body.failed).to.equal(0)
    })
  })
})

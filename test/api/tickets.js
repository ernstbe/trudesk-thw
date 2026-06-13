/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const request = require('supertest')

describe('api/tickets.js', function () {
  const tdapikey = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
  const api = request('http://localhost:3111')
  let createdTicketId
  let createdTicketUid

  before(async function () {
    // Ensure the admin user is in the TEST group so ticket creation works
    const groupSchema = require('../../src/models/group')
    const userSchema = require('../../src/models/user')
    const user = await userSchema.getUserByUsername('trudesk')
    const group = await groupSchema.getGroupByName('TEST')
    if (!group.isMember(user._id)) {
      await group.addMember(user._id)
    }
  })

  it('should create a ticket via API', async function () {
    const tickettype = require('../../src/models/tickettype')
    const groupSchema = require('../../src/models/group')
    const prioritySchema = require('../../src/models/ticketpriority')

    const type = await tickettype.getTypeByName('Task')
    expect(type).to.be.a('object')
    const group = await groupSchema.getGroupByName('TEST')
    expect(group).to.be.a('object')
    const priority = await prioritySchema.findOne({ default: true })
    expect(priority).to.be.a('object')

    const ticket = {
      subject: 'API Test Ticket',
      issue: 'This is a test issue created via API',
      type: type._id.toString(),
      group: group._id.toString(),
      priority: priority._id.toString(),
      tags: []
    }

    const res = await api
      .post('/api/v1/tickets/create')
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send(ticket)

    if (res.status !== 200) {
      throw new Error('Ticket creation failed: ' + JSON.stringify(res.body))
    }
    expect(res.body.success).to.be.true
    expect(res.body.ticket).to.be.a('object')
    expect(res.body.ticket.subject).to.equal('API Test Ticket')
    createdTicketId = res.body.ticket._id
    createdTicketUid = res.body.ticket.uid
  })

  it('should get tickets via API', function (done) {
    api
      .get('/api/v1/tickets')
      .set('accesstoken', tdapikey)
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
        expect(res.body.tickets).to.be.a('array')
      })
      .end(done)
  })

  it('should get a single ticket via API', function (done) {
    api
      .get('/api/v1/tickets/' + createdTicketUid)
      .set('accesstoken', tdapikey)
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
        expect(res.body.ticket).to.be.a('object')
        expect(res.body.ticket.uid).to.equal(createdTicketUid)
      })
      .end(done)
  })

  it('should update a ticket via API', function (done) {
    api
      .put('/api/v1/tickets/' + createdTicketId)
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ subject: 'Updated API Test Ticket' })
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
      })
      .end(done)
  })

  it('should update a ticket type via API', async function () {
    // Regression test: the PUT /tickets/:id handler used to drop the
    // `type` field on the floor, so the PWA's Type-chip change was a
    // silent no-op. Pick a different type than the one used at create
    // time, then assert the ticket comes back populated with it.
    const tickettype = require('../../src/models/tickettype')
    const types = await tickettype.find({})
    const otherType = types.find(function (t) { return t.name !== 'Task' }) || types[1] || types[0]
    expect(otherType).to.be.a('object')

    const res = await api
      .put('/api/v1/tickets/' + createdTicketId)
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ type: otherType._id.toString() })

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    expect(res.body.ticket).to.be.a('object')
    expect(String(res.body.ticket.type._id || res.body.ticket.type))
      .to.equal(otherType._id.toString())
  })

  it('should update a ticket due date via API', async function () {
    // Regression test: the PUT /tickets/:id handler used to drop the
    // `dueDate` field on the floor, so due dates set in the PWA after
    // ticket creation never persisted and the overdue dashboard count
    // stayed at zero.
    const dueDate = new Date('2030-01-15T00:00:00.000Z')

    const res = await api
      .put('/api/v1/tickets/' + createdTicketId)
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ dueDate: dueDate.toISOString() })

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    expect(res.body.ticket).to.be.a('object')
    expect(new Date(res.body.ticket.dueDate).getTime()).to.equal(dueDate.getTime())

    // A history entry documents the change
    const historyActions = res.body.ticket.history.map(function (h) { return h.action })
    expect(historyActions).to.include('ticket:set:duedate')
  })

  it('should clear a ticket due date via API', async function () {
    const res = await api
      .put('/api/v1/tickets/' + createdTicketId)
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ dueDate: null })

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    expect(res.body.ticket.dueDate).to.not.exist
  })

  it('should reject an invalid due date via API', async function () {
    const res = await api
      .put('/api/v1/tickets/' + createdTicketId)
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ dueDate: 'not-a-date' })

    expect(res.status).to.equal(400)
    expect(res.body.success).to.be.false
  })

  it('should add a comment to a ticket', function (done) {
    api
      .post('/api/v1/tickets/addcomment')
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ comment: 'This is a test comment via API', _id: createdTicketId })
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
      })
      .end(done)
  })

  it('should preserve blank lines in a comment', function (done) {
    api
      .post('/api/v1/tickets/addcomment')
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ comment: 'Zeile A\n\n\nZeile B', _id: createdTicketId })
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
        const comments = res.body.ticket.comments
        const last = comments[comments.length - 1]
        // Three newlines (two blank lines) must survive as <br> instead of
        // collapsing into a single paragraph break.
        const brCount = (last.comment.match(/<br/g) || []).length
        expect(brCount).to.be.at.least(3)
      })
      .end(done)
  })

  it('should preserve blank lines in an internal note', function (done) {
    api
      .post('/api/v1/tickets/addnote')
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ note: 'Note A\n\n\nNote B', ticketid: createdTicketId })
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
        const notes = res.body.ticket.notes
        const last = notes[notes.length - 1]
        const brCount = (last.note.match(/<br/g) || []).length
        expect(brCount).to.be.at.least(3)
      })
      .end(done)
  })

  it('should get ticket types', function (done) {
    api
      .get('/api/v1/tickets/types')
      .set('accesstoken', tdapikey)
      .expect(200)
      .expect(function (res) {
        expect(res.body).to.be.a('array')
        expect(res.body.length).to.be.at.least(1)
      })
      .end(done)
  })

  it('should get ticket priorities', function (done) {
    api
      .get('/api/v1/tickets/priorities')
      .set('accesstoken', tdapikey)
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
        expect(res.body.priorities).to.be.a('array')
        expect(res.body.priorities.length).to.be.at.least(1)
      })
      .end(done)
  })

  it('should get ticket statuses', function (done) {
    api
      .get('/api/v1/tickets/status')
      .set('accesstoken', tdapikey)
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
        expect(res.body.status).to.be.a('array')
        expect(res.body.status.length).to.be.at.least(1)
      })
      .end(done)
  })

  it('should reject ticket creation without required fields', function (done) {
    api
      .post('/api/v1/tickets/create')
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({})
      .expect(400, done)
  })

  it('should set additional assignees via API', async function () {
    const userSchema = require('../../src/models/user')
    const admin = await userSchema.getUserByUsername('trudesk')
    const support = await userSchema.getUserByUsername('fake.user')
    expect(admin).to.be.a('object')
    expect(support).to.be.a('object')

    const res = await api
      .put('/api/v1/tickets/' + createdTicketId + '/additional-assignees')
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ additionalAssignees: [admin._id.toString(), support._id.toString()] })

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    expect(res.body.ticket).to.be.a('object')
    expect(res.body.ticket.additionalAssignees).to.be.a('array')
    expect(res.body.ticket.additionalAssignees).to.have.length(2)

    const usernames = res.body.ticket.additionalAssignees.map(function (u) {
      return u.username
    })
    expect(usernames).to.include('trudesk')
    expect(usernames).to.include('fake.user')

    const historyActions = res.body.ticket.history.map(function (h) {
      return h.action
    })
    expect(historyActions).to.include('ticket:set:additionalAssignees')
  })

  it('should clear additional assignees via API with an empty array', async function () {
    const res = await api
      .put('/api/v1/tickets/' + createdTicketId + '/additional-assignees')
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ additionalAssignees: [] })

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    expect(res.body.ticket.additionalAssignees).to.have.length(0)
  })

  it('should reject invalid additional assignee ids via API', async function () {
    const res = await api
      .put('/api/v1/tickets/' + createdTicketId + '/additional-assignees')
      .set('accesstoken', tdapikey)
      .set('Content-Type', 'application/json')
      .send({ additionalAssignees: ['not-an-objectid'] })

    expect(res.status).to.equal(400)
    expect(res.body.success).to.be.false
  })

  it('should delete a ticket via API', function (done) {
    api
      .delete('/api/v1/tickets/' + createdTicketId)
      .set('accesstoken', tdapikey)
      .expect(200)
      .expect(function (res) {
        expect(res.body.success).to.be.true
      })
      .end(done)
  })
})

/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')
const m = require('mongoose')

describe('api/recurringTasks.js', function () {
  const agent = superagent.agent()
  let createdTaskId
  let checklistTaskId
  const originalTicketTypeId = new m.Types.ObjectId().toString()
  const baseUrl = 'http://localhost:3111'

  before(function (done) {
    agent
      .post(baseUrl + '/login')
      .type('json')
      .send({
        'login-username': 'trudesk',
        'login-password': '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW'
      })
      .end(function (err, res) {
        if (err) return done(err)
        expect(res.status).to.equal(200)
        done()
      })
  })

  it('should create a recurring task via API', function (done) {
    agent
      .post(baseUrl + '/api/v2/recurring-tasks')
      .type('json')
      .send({
        name: 'API Monatliche Wartung',
        description: 'Wartung der Heizungsanlage',
        ticketSubject: 'Heizungswartung faellig',
        ticketIssue: 'Bitte Heizungswartung durchfuehren',
        ticketType: originalTicketTypeId,
        ticketGroup: new m.Types.ObjectId().toString(),
        ticketPriority: new m.Types.ObjectId().toString(),
        scheduleType: 'monthly',
        dayOfMonth: 1,
        daysBeforeDeadline: 7
      })
      .end(function (err, res) {
        if (err) return done(err)
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTask).to.be.a('object')
        expect(res.body.recurringTask.name).to.equal('API Monatliche Wartung')
        expect(res.body.recurringTask.enabled).to.be.true
        createdTaskId = res.body.recurringTask._id
        done()
      })
  })

  it('should create a recurring task with a checklist', function (done) {
    agent
      .post(baseUrl + '/api/v2/recurring-tasks')
      .type('json')
      .send({
        name: 'API Wartung mit Checkliste',
        ticketSubject: 'Wartung mit Checkliste',
        ticketIssue: 'Bitte Checkliste abarbeiten',
        ticketType: new m.Types.ObjectId().toString(),
        ticketGroup: new m.Types.ObjectId().toString(),
        ticketPriority: new m.Types.ObjectId().toString(),
        scheduleType: 'monthly',
        checklist: [{ title: '  Filter pruefen  ' }, { title: 'Oelstand kontrollieren' }]
      })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTask.checklist).to.be.a('array')
        expect(res.body.recurringTask.checklist).to.have.length(2)
        expect(res.body.recurringTask.checklist[0].title).to.equal('Filter pruefen')
        expect(res.body.recurringTask.checklist[1].title).to.equal('Oelstand kontrollieren')
        checklistTaskId = res.body.recurringTask._id
        done()
      })
  })

  it('should reject a non-array checklist on create', function (done) {
    agent
      .post(baseUrl + '/api/v2/recurring-tasks')
      .type('json')
      .send({
        name: 'API Ungueltige Checkliste',
        ticketSubject: 'Wartung',
        ticketIssue: 'Wartung',
        ticketType: new m.Types.ObjectId().toString(),
        ticketGroup: new m.Types.ObjectId().toString(),
        ticketPriority: new m.Types.ObjectId().toString(),
        scheduleType: 'monthly',
        checklist: 'garbage'
      })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should reject create without ticketGroup with a 400', function (done) {
    agent
      .post(baseUrl + '/api/v2/recurring-tasks')
      .type('json')
      .send({
        name: 'API Ohne Gruppe',
        ticketSubject: 'Wartung',
        ticketIssue: 'Wartung',
        ticketType: new m.Types.ObjectId().toString(),
        ticketPriority: new m.Types.ObjectId().toString(),
        scheduleType: 'monthly'
      })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        expect(res.body.error).to.contain('ticketGroup')
        done()
      })
  })

  it('should reject an oversized checklist with a 400', function (done) {
    const checklist = []
    for (let i = 0; i < 101; i++) checklist.push({ title: 'Item ' + i })

    agent
      .post(baseUrl + '/api/v2/recurring-tasks')
      .type('json')
      .send({
        name: 'API Zu viele Items',
        ticketSubject: 'Wartung',
        ticketIssue: 'Wartung',
        ticketType: new m.Types.ObjectId().toString(),
        ticketGroup: new m.Types.ObjectId().toString(),
        ticketPriority: new m.Types.ObjectId().toString(),
        scheduleType: 'monthly',
        checklist
      })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should get all recurring tasks', function (done) {
    agent
      .get(baseUrl + '/api/v2/recurring-tasks')
      .end(function (err, res) {
        if (err) return done(err)
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTasks).to.be.a('array')
        expect(res.body.recurringTasks.length).to.be.at.least(1)
        done()
      })
  })

  it('should get a single recurring task', function (done) {
    agent
      .get(baseUrl + '/api/v2/recurring-tasks/' + createdTaskId)
      .end(function (err, res) {
        if (err) return done(err)
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTask.name).to.equal('API Monatliche Wartung')
        done()
      })
  })

  it('should return 404 for non-existent task', function (done) {
    agent
      .get(baseUrl + '/api/v2/recurring-tasks/000000000000000000000000')
      .end(function (_err, res) {
        expect(res.status).to.equal(404)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should update a recurring task', function (done) {
    agent
      .put(baseUrl + '/api/v2/recurring-tasks/' + createdTaskId)
      .type('json')
      .send({
        name: 'API Wartung (aktualisiert)',
        scheduleType: 'quarterly',
        daysBeforeDeadline: 14
      })
      .end(function (err, res) {
        if (err) return done(err)
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTask.name).to.equal('API Wartung (aktualisiert)')
        expect(res.body.recurringTask.scheduleType).to.equal('quarterly')
        done()
      })
  })

  it('should ignore an explicit null for required ref fields on update', function (done) {
    agent
      .put(baseUrl + '/api/v2/recurring-tasks/' + createdTaskId)
      .type('json')
      .send({ ticketType: null, description: 'null darf nicht crashen' })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true

        const RecurringTask = require('../../src/models/recurringTask')
        RecurringTask.findById(createdTaskId)
          .then(function (task) {
            expect(task.ticketType.toString()).to.equal(originalTicketTypeId)
            expect(task.description).to.equal('null darf nicht crashen')
            done()
          })
          .catch(done)
      })
  })

  it('should not recalculate nextRun on a checklist-only update', function (done) {
    const RecurringTask = require('../../src/models/recurringTask')
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    RecurringTask.updateOne({ _id: createdTaskId }, { $set: { nextRun: pastDate } })
      .then(function () {
        agent
          .put(baseUrl + '/api/v2/recurring-tasks/' + createdTaskId)
          .type('json')
          .send({ checklist: [{ title: 'Nur Checkliste geaendert' }] })
          .end(function (_err, res) {
            expect(res.status).to.equal(200)
            expect(res.body.success).to.be.true

            RecurringTask.findById(createdTaskId)
              .then(function (task) {
                expect(task.nextRun.getTime()).to.equal(pastDate.getTime())
                done()
              })
              .catch(done)
          })
      })
      .catch(done)
  })

  it('should recalculate nextRun when the schedule changes', function (done) {
    const RecurringTask = require('../../src/models/recurringTask')
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    agent
      .put(baseUrl + '/api/v2/recurring-tasks/' + createdTaskId)
      .type('json')
      .send({ dayOfMonth: 15 })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true

        RecurringTask.findById(createdTaskId)
          .then(function (task) {
            expect(task.nextRun.getTime()).to.not.equal(pastDate.getTime())
            expect(task.nextRun.getTime()).to.be.greaterThan(Date.now())
            done()
          })
          .catch(done)
      })
  })

  it('should disable a recurring task', function (done) {
    agent
      .put(baseUrl + '/api/v2/recurring-tasks/' + createdTaskId)
      .type('json')
      .send({ enabled: false })
      .end(function (err, res) {
        if (err) return done(err)
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTask.enabled).to.be.false
        done()
      })
  })

  it('should replace the checklist on update', function (done) {
    agent
      .put(baseUrl + '/api/v2/recurring-tasks/' + checklistTaskId)
      .type('json')
      .send({
        checklist: [{ title: 'Ersatzschritt' }]
      })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTask.checklist).to.have.length(1)
        expect(res.body.recurringTask.checklist[0].title).to.equal('Ersatzschritt')
        done()
      })
  })

  it('should keep the checklist unchanged when omitted on update', function (done) {
    agent
      .put(baseUrl + '/api/v2/recurring-tasks/' + checklistTaskId)
      .type('json')
      .send({ description: 'Nur Beschreibung geaendert' })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTask.checklist).to.have.length(1)
        expect(res.body.recurringTask.checklist[0].title).to.equal('Ersatzschritt')
        done()
      })
  })

  it('should reject a non-array checklist on update', function (done) {
    agent
      .put(baseUrl + '/api/v2/recurring-tasks/' + checklistTaskId)
      .type('json')
      .send({ checklist: 'garbage' })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should clear the checklist when updating with an empty array', function (done) {
    agent
      .put(baseUrl + '/api/v2/recurring-tasks/' + checklistTaskId)
      .type('json')
      .send({ checklist: [] })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.recurringTask.checklist).to.have.length(0)
        done()
      })
  })

  it('should delete the checklist recurring task', function (done) {
    agent
      .delete(baseUrl + '/api/v2/recurring-tasks/' + checklistTaskId)
      .end(function (err, res) {
        if (err) return done(err)
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        done()
      })
  })

  it('should delete a recurring task', function (done) {
    agent
      .delete(baseUrl + '/api/v2/recurring-tasks/' + createdTaskId)
      .end(function (err, res) {
        if (err) return done(err)
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        done()
      })
  })

  it('should reject unauthenticated requests', function (done) {
    const unauthAgent = superagent.agent()
    unauthAgent
      .get(baseUrl + '/api/v2/recurring-tasks')
      .end(function (_err, res) {
        expect(res.status).to.not.equal(200)
        done()
      })
  })
})

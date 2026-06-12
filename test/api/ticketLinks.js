/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

describe('api/ticketLinks.js', function () {
  const agent = superagent.agent()
  const baseUrl = 'http://localhost:3111'
  let ticketAUid
  let ticketBUid
  let ticketCUid

  before(function (done) {
    agent
      .post(baseUrl + '/login')
      .type('json')
      .send({
        'login-username': 'trudesk',
        'login-password': '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW'
      })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)

        const tickettype = require('../../src/models/tickettype')
        const groupSchema = require('../../src/models/group')
        const prioritySchema = require('../../src/models/ticketpriority')
        const userSchema = require('../../src/models/user')
        const statusSchema = require('../../src/models/ticketStatus')
        const Ticket = require('../../src/models/ticket')

        Promise.all([
          tickettype.getTypeByName('Task'),
          groupSchema.getGroupByName('TEST'),
          prioritySchema.findOne({ default: true }),
          userSchema.getUserByUsername('trudesk'),
          statusSchema.findOne({ uid: 0 })
        ]).then(function (results) {
          const base = {
            owner: results[3]._id,
            group: results[1]._id,
            type: results[0]._id,
            status: results[4]._id,
            priority: results[2]._id,
            issue: 'Testing linked tickets'
          }
          Promise.all([
            Ticket.create(Object.assign({}, base, { subject: 'Link Test Ticket A' })),
            Ticket.create(Object.assign({}, base, { subject: 'Link Test Ticket B' })),
            Ticket.create(Object.assign({}, base, { subject: 'Link Test Ticket C' }))
          ]).then(function (tickets) {
            ticketAUid = tickets[0].uid
            ticketBUid = tickets[1].uid
            ticketCUid = tickets[2].uid
            done()
          }).catch(done)
        }).catch(done)
      })
  })

  function findLink (ticket, targetUid) {
    return (ticket.linkedTickets || []).find(function (l) {
      return l.ticket && l.ticket.uid === targetUid
    })
  }

  it('should link two tickets (default linkType related)', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/' + ticketAUid + '/links')
      .type('json')
      .send({ targetUid: ticketBUid })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(res.body.ticket.linkedTickets).to.be.a('array')
        const link = findLink(res.body.ticket, ticketBUid)
        expect(link).to.exist
        expect(link.linkType).to.equal('related')
        expect(link.ticket.subject).to.equal('Link Test Ticket B')
        expect(link.ticket.status).to.exist
        done()
      })
  })

  it('should expose the link on the target ticket via GET (bidirectional)', function (done) {
    agent
      .get(baseUrl + '/api/v2/tickets/' + ticketBUid)
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        const link = findLink(res.body.ticket, ticketAUid)
        expect(link).to.exist
        expect(link.linkType).to.equal('related')
        expect(link.ticket.subject).to.equal('Link Test Ticket A')
        done()
      })
  })

  it('should store the inverse type blockedBy on the target for a blocks link', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/' + ticketAUid + '/links')
      .type('json')
      .send({ targetUid: ticketCUid, linkType: 'blocks' })
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        const link = findLink(res.body.ticket, ticketCUid)
        expect(link).to.exist
        expect(link.linkType).to.equal('blocks')

        agent
          .get(baseUrl + '/api/v2/tickets/' + ticketCUid)
          .end(function (_err2, res2) {
            expect(res2.status).to.equal(200)
            const inverse = findLink(res2.body.ticket, ticketAUid)
            expect(inverse).to.exist
            expect(inverse.linkType).to.equal('blockedBy')
            done()
          })
      })
  })

  it('should reject a self-link', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/' + ticketAUid + '/links')
      .type('json')
      .send({ targetUid: ticketAUid })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should reject a duplicate link', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/' + ticketAUid + '/links')
      .type('json')
      .send({ targetUid: ticketBUid, linkType: 'duplicate' })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should reject a duplicate link created from the other side', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/' + ticketBUid + '/links')
      .type('json')
      .send({ targetUid: ticketAUid })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should return 404 for an unknown target ticket', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/' + ticketAUid + '/links')
      .type('json')
      .send({ targetUid: 999999 })
      .end(function (_err, res) {
        expect(res.status).to.equal(404)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should return 404 for an unknown source ticket', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/999999/links')
      .type('json')
      .send({ targetUid: ticketAUid })
      .end(function (_err, res) {
        expect(res.status).to.equal(404)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should reject an invalid linkType', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/' + ticketBUid + '/links')
      .type('json')
      .send({ targetUid: ticketCUid, linkType: 'follows' })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should reject blockedBy as client input', function (done) {
    agent
      .post(baseUrl + '/api/v2/tickets/' + ticketBUid + '/links')
      .type('json')
      .send({ targetUid: ticketCUid, linkType: 'blockedBy' })
      .end(function (_err, res) {
        expect(res.status).to.equal(400)
        expect(res.body.success).to.be.false
        done()
      })
  })

  it('should remove a link from both tickets', function (done) {
    agent
      .delete(baseUrl + '/api/v2/tickets/' + ticketAUid + '/links/' + ticketBUid)
      .end(function (_err, res) {
        expect(res.status).to.equal(200)
        expect(res.body.success).to.be.true
        expect(findLink(res.body.ticket, ticketBUid)).to.not.exist

        agent
          .get(baseUrl + '/api/v2/tickets/' + ticketBUid)
          .end(function (_err2, res2) {
            expect(res2.status).to.equal(200)
            expect(findLink(res2.body.ticket, ticketAUid)).to.not.exist
            done()
          })
      })
  })

  it('should return 404 when removing a non-existent link', function (done) {
    agent
      .delete(baseUrl + '/api/v2/tickets/' + ticketAUid + '/links/' + ticketBUid)
      .end(function (_err, res) {
        expect(res.status).to.equal(404)
        expect(res.body.success).to.be.false
        done()
      })
  })
})

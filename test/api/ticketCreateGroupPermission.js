const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')

// Regression coverage for the bug where any authenticated user with the
// generic `tickets:create` permission could POST a ticket against an
// arbitrary group id — the server simply persisted whatever group was in
// the request body. Both v1 (/api/v1/tickets/create) and v2
// (/api/v2/tickets) now reject groups the caller cannot reach via their
// team→department mapping (admin/agent) or direct membership (everyone
// else), mirroring ticketsV2.single + accountsApi.sessionUser.
describe('ticket create — group access enforcement', function () {
  const baseUrl = 'http://localhost:3111'
  const orphanToken = 'orphan-admin-token'
  let orphanAdmin
  let testGroupId
  let typeId
  let priorityId

  before(async function () {
    const adminRole = (await roleSchema.getRoles()).find(r => r.normalized === 'admin')
    orphanAdmin = await userSchema.create({
      username: 'orphan.admin',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Orphan Admin',
      email: 'orphan.admin@trudesk.io',
      role: adminRole._id,
      accessToken: orphanToken
    })

    const group = await groupSchema.getGroupByName('TEST')
    testGroupId = group._id.toString()
    const type = await tickettype.getTypeByName('Task')
    typeId = type._id.toString()
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    priorityId = priority._id.toString()
  })

  after(async function () {
    if (orphanAdmin) await userSchema.deleteOne({ _id: orphanAdmin._id })
  })

  it('POST /api/v1/tickets/create returns 403 when the caller cannot reach the group', async function () {
    try {
      await superagent
        .post(baseUrl + '/api/v1/tickets/create')
        .set('accesstoken', orphanToken)
        .type('json')
        .send({
          subject: 'Should be rejected',
          issue: 'Caller has no team/department mapping that covers TEST',
          type: typeId,
          group: testGroupId,
          priority: priorityId,
          tags: []
        })
      throw new Error('expected 403 but request succeeded')
    } catch (err) {
      expect(err.status).to.equal(403)
      expect(err.response.body.success).to.equal(false)
      expect(err.response.body.error).to.match(/Forbidden/i)
    }
  })

  it('POST /api/v2/tickets returns 403 when the caller cannot reach the group', async function () {
    try {
      await superagent
        .post(baseUrl + '/api/v2/tickets')
        .set('accesstoken', orphanToken)
        .type('json')
        .send({
          subject: 'Should be rejected',
          issue: 'Caller has no team/department mapping that covers TEST',
          type: typeId,
          group: testGroupId,
          priority: priorityId,
          tags: []
        })
      throw new Error('expected 403 but request succeeded')
    } catch (err) {
      expect(err.status).to.equal(403)
      expect(err.response.body.success).to.equal(false)
      expect(err.response.body.error).to.match(/Forbidden/i)
    }
  })

  it('POST /api/v2/tickets rejects requests without a group', async function () {
    try {
      await superagent
        .post(baseUrl + '/api/v2/tickets')
        .set('accesstoken', orphanToken)
        .type('json')
        .send({
          subject: 'No group',
          issue: 'missing group'
        })
      throw new Error('expected 400 but request succeeded')
    } catch (err) {
      expect(err.status).to.equal(400)
      expect(err.response.body.success).to.equal(false)
    }
  })
})

/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const groupSchema = require('../../src/models/group')
const ticketSchema = require('../../src/models/ticket')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')

// Ticket favorites ("Favoriten") are stored per user on the server so they
// follow the user across devices. Only tickets the caller may see can be
// starred, and every call only ever touches the caller's own list.
describe('api/v2/accounts/me/favorites', function () {
  const baseUrl = 'http://localhost:3111'
  const memberToken = 'favorites-member-token'
  const otherToken = 'favorites-other-token'

  let member
  let other
  let visibleGroup
  let hiddenGroup
  let visibleTicket
  let hiddenTicket

  before(async function () {
    const userRole = (await roleSchema.getRoles()).find(r => r.normalized === 'user')
    member = await userSchema.create({
      username: 'favorites.member',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Favorites Member',
      email: 'favorites.member@trudesk.io',
      role: userRole._id,
      accessToken: memberToken
    })
    other = await userSchema.create({
      username: 'favorites.other',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Favorites Other',
      email: 'favorites.other@trudesk.io',
      role: userRole._id,
      accessToken: otherToken
    })

    visibleGroup = await groupSchema.create({ name: 'Favorites Visible', members: [member._id, other._id] })
    hiddenGroup = await groupSchema.create({ name: 'Favorites Hidden', members: [other._id] })

    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    const status = await require('../../src/helpers/defaultTicketStatus').resolveDefaultTicketStatus()
    const base = { owner: other._id, type: type._id, priority: priority._id, status: status._id }

    visibleTicket = await ticketSchema.create({ ...base, group: visibleGroup._id, subject: 'Fav visible', issue: 'x' })
    hiddenTicket = await ticketSchema.create({ ...base, group: hiddenGroup._id, subject: 'Fav hidden', issue: 'x' })
  })

  after(async function () {
    await ticketSchema.deleteMany({ _id: { $in: [visibleTicket._id, hiddenTicket._id] } })
    await groupSchema.deleteMany({ _id: { $in: [visibleGroup._id, hiddenGroup._id] } })
    await userSchema.deleteMany({ _id: { $in: [member._id, other._id] } })
  })

  function call (method, path, token) {
    return new Promise(function (resolve) {
      superagent[method](baseUrl + path)
        .set('accesstoken', token)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  it('starts empty', async function () {
    const res = await call('get', '/api/v2/accounts/me/favorites', memberToken)
    expect(res.status).to.equal(200)
    expect(res.body.favorites).to.deep.equal([])
  })

  it('adds a visible ticket, idempotently', async function () {
    const first = await call('put', '/api/v2/accounts/me/favorites/' + visibleTicket.uid, memberToken)
    expect(first.status).to.equal(200)
    expect(first.body.favorites).to.deep.equal([visibleTicket.uid])

    const second = await call('put', '/api/v2/accounts/me/favorites/' + visibleTicket.uid, memberToken)
    expect(second.status).to.equal(200)
    expect(second.body.favorites).to.deep.equal([visibleTicket.uid])

    const list = await call('get', '/api/v2/accounts/me/favorites', memberToken)
    expect(list.body.favorites).to.deep.equal([visibleTicket.uid])
  })

  it('refuses a ticket in a group the caller cannot see', async function () {
    const res = await call('put', '/api/v2/accounts/me/favorites/' + hiddenTicket.uid, memberToken)
    expect(res.status).to.equal(403)

    const list = await call('get', '/api/v2/accounts/me/favorites', memberToken)
    expect(list.body.favorites).to.not.include(hiddenTicket.uid)
  })

  it('rejects an invalid or unknown uid', async function () {
    expect((await call('put', '/api/v2/accounts/me/favorites/abc', memberToken)).status).to.equal(400)
    expect((await call('put', '/api/v2/accounts/me/favorites/-3', memberToken)).status).to.equal(400)
    expect((await call('put', '/api/v2/accounts/me/favorites/987654', memberToken)).status).to.equal(404)
    expect((await call('delete', '/api/v2/accounts/me/favorites/abc', memberToken)).status).to.equal(400)
  })

  it('keeps each user\'s list separate', async function () {
    const res = await call('get', '/api/v2/accounts/me/favorites', otherToken)
    expect(res.status).to.equal(200)
    expect(res.body.favorites).to.deep.equal([])
  })

  it('includes favorites in the DSGVO data export', async function () {
    const res = await call('get', '/api/v2/accounts/me/export', memberToken)
    expect(res.status).to.equal(200)
    expect(res.body.favoriteTicketUids).to.deep.equal([visibleTicket.uid])
  })

  it('removes a favorite', async function () {
    const res = await call('delete', '/api/v2/accounts/me/favorites/' + visibleTicket.uid, memberToken)
    expect(res.status).to.equal(200)
    expect(res.body.favorites).to.deep.equal([])
  })

  it('rejects unauthenticated requests', async function () {
    const res = await new Promise(function (resolve) {
      superagent
        .get(baseUrl + '/api/v2/accounts/me/favorites')
        .ok(function () { return true })
        .end(function (err, r) { resolve(err ? { status: err.status || 0 } : r) })
    })
    expect(res.status).to.equal(401)
  })
})

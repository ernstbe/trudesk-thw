/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')
const mongoose = require('mongoose')

// Every cookie-less request used to mint a CSRF secret and therefore a new
// session with a 1-year lifetime. An uptime monitor polling GET /login (which
// redirects to /) left two sessions per minute in MongoDB: 570k+ in
// production. Health checks and the /login redirect must not create sessions,
// and anonymous sessions must expire after a day, while a logged-in session
// keeps the full year.
describe('session churn from anonymous requests', function () {
  const baseUrl = 'http://localhost:3111'
  const DAY = 24 * 60 * 60 * 1000

  const sessions = () => mongoose.connection.db.collection('sessions')

  function sessionIdFrom (res) {
    const raw = (res.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='))
    if (!raw) return null
    const value = decodeURIComponent(raw.split(';')[0].slice('connect.sid='.length))
    // signed cookie: "s:<id>.<signature>"
    return value.slice(2, value.lastIndexOf('.'))
  }

  function get (path, agent) {
    return new Promise(function (resolve) {
      ;(agent || superagent)
        .get(baseUrl + path)
        .redirects(0)
        .ok(function () { return true })
        .end(function (err, res) { resolve(err ? err.response : res) })
    })
  }

  for (const path of ['/healthz', '/version', '/login']) {
    it('GET ' + path + ' without a cookie creates no session', async function () {
      const before = await sessions().countDocuments()
      const res = await get(path)
      expect(res.status).to.be.oneOf([200, 302])
      expect(sessionIdFrom(res)).to.be.null
      expect(await sessions().countDocuments()).to.equal(before)
    })
  }

  it('the anonymous login page session expires after one day', async function () {
    const res = await get('/')
    expect(res.status).to.equal(200)
    const sid = sessionIdFrom(res)
    expect(sid).to.be.a('string')

    const doc = await sessions().findOne({ _id: sid })
    expect(doc).to.not.be.null
    const ttl = new Date(doc.expires).getTime() - Date.now()
    expect(ttl).to.be.within(DAY - 60 * 1000, DAY + 60 * 1000)
  })

  it('a logged-in session keeps the one-year lifetime', async function () {
    const agent = superagent.agent()
    const res = await new Promise(function (resolve) {
      agent
        .post(baseUrl + '/login')
        .type('json')
        .send({
          'login-username': 'trudesk',
          'login-password': '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW'
        })
        .redirects(0)
        .ok(function () { return true })
        .end(function (err, r) { resolve(err ? err.response : r) })
    })
    const sid = sessionIdFrom(res)
    expect(sid).to.be.a('string')

    // An authenticated request must not shrink it back to a day.
    await get('/healthz', agent)

    const doc = await sessions().findOne({ _id: sid })
    expect(doc).to.not.be.null
    expect(doc.session).to.match(/"passport":\{"user"/)
    const ttl = new Date(doc.expires).getTime() - Date.now()
    expect(ttl).to.be.above(300 * DAY)
  })
})

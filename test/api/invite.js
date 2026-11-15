const crypto = require('crypto')
const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const accountTokens = require('../../src/helpers/accountTokens')

// #invite: admins invite users by link instead of handing out passwords;
// "Passwort vergessen" uses the same one-time link mechanism.
describe('invitation and password-reset links (#invite)', function () {
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
  const goodPassword = 'Einladung-2026!'

  const createdIds = []

  after(async function () {
    await userSchema.deleteMany({ _id: { $in: createdIds } })
  })

  function call (method, path, { token, body, redirects } = {}) {
    return new Promise(function (resolve) {
      let req = superagent[method](baseUrl + path).ok(function () { return true })
      if (token) req = req.set('accesstoken', token)
      if (redirects !== undefined) req = req.redirects(redirects)
      if (body) req = req.send(body)
      req.end(function (err, res) { resolve(err ? { status: err.status || 0, body: {}, headers: {} } : res) })
    })
  }

  function tokenFromUrl (url) {
    return url.split('/').pop()
  }

  async function invite (suffix) {
    const res = await call('post', '/api/v2/accounts', {
      token: adminToken,
      body: {
        username: `invite.${suffix}`,
        fullname: `Invite ${suffix}`,
        email: `invite.${suffix}@trudesk.io`,
        role: global.userRoleId,
        sendInvite: true
      }
    })
    expect(res.status, JSON.stringify(res.body)).to.equal(200)
    createdIds.push(res.body.account._id)
    return res
  }

  describe('creating an invited account', function () {
    let res
    before(async function () {
      res = await invite('create')
    })

    it('needs no password and marks the account pending', async function () {
      expect(res.body.account.invitePending).to.equal(true)
      expect(res.body.invite.url).to.match(/\/einladung\/[A-Za-z0-9_-]{43}$/)
      // The test environment has no mailer configured.
      expect(res.body.invite.mailed).to.equal(false)
    })

    it('stores only the hash of the link token', async function () {
      const token = tokenFromUrl(res.body.invite.url)
      const dbUser = await userSchema.findOne({ username: 'invite.create' }, '+inviteTokenHash +inviteExpire')
      expect(dbUser.inviteTokenHash).to.equal(crypto.createHash('sha256').update(token).digest('hex'))
      expect(dbUser.inviteTokenHash).to.not.contain(token)
      const days = (dbUser.inviteExpire - Date.now()) / (24 * 60 * 60 * 1000)
      expect(days).to.be.within(6.9, 7.01)
    })

    it('does not leak the token hash in the account listing', async function () {
      const list = await call('get', '/api/v2/accounts?type=all&limit=-1', { token: adminToken })
      const entry = list.body.accounts.find(a => a.username === 'invite.create')
      expect(entry.invitePending).to.equal(true)
      expect(entry).to.not.have.property('inviteTokenHash')
    })

    it('still requires a password when no invitation is sent', async function () {
      const r = await call('post', '/api/v2/accounts', {
        token: adminToken,
        body: { username: 'invite.nopass', fullname: 'No Pass', email: 'invite.nopass@trudesk.io', role: global.userRoleId }
      })
      expect(r.status).to.equal(500)
      expect(await userSchema.findOne({ username: 'invite.nopass' })).to.equal(null)
    })
  })

  describe('accepting an invitation', function () {
    let token
    before(async function () {
      const res = await invite('accept')
      token = tokenFromUrl(res.body.invite.url)
    })

    it('refuses login while the invitation is pending', async function () {
      const dbUser = await userSchema.findOne({ username: 'invite.accept' })
      expect(dbUser.invitePending).to.equal(true)
      const r = await call('post', '/api/v1/login', { body: { username: 'invite.accept', password: goodPassword } })
      expect(r.status).to.equal(401)
    })

    it('shows who the link is for', async function () {
      const r = await call('get', `/api/v2/public/invite/${token}`)
      expect(r.status).to.equal(200)
      expect(r.body.account).to.deep.equal({ fullname: 'Invite accept', username: 'invite.accept' })
    })

    it('answers 404 for malformed and unknown tokens', async function () {
      expect((await call('get', '/api/v2/public/invite/nope')).status).to.equal(404)
      const unknown = crypto.randomBytes(32).toString('base64url')
      expect((await call('get', `/api/v2/public/invite/${unknown}`)).status).to.equal(404)
    })

    it('does not accept an invite token on the reset endpoint', async function () {
      expect((await call('get', `/api/v2/public/password-reset/${token}`)).status).to.equal(404)
    })

    it('rejects short and mismatching passwords', async function () {
      const short = await call('post', `/api/v2/public/invite/${token}`, { body: { password: 'kurz', passwordConfirm: 'kurz' } })
      expect(short.status).to.equal(400)
      const mismatch = await call('post', `/api/v2/public/invite/${token}`, {
        body: { password: goodPassword, passwordConfirm: goodPassword + 'x' }
      })
      expect(mismatch.status).to.equal(400)
    })

    it('sets the password, activates the account and allows login', async function () {
      const r = await call('post', `/api/v2/public/invite/${token}`, { body: { password: goodPassword, passwordConfirm: goodPassword } })
      expect(r.status, JSON.stringify(r.body)).to.equal(200)
      expect(r.body.username).to.equal('invite.accept')

      const dbUser = await userSchema.findOne({ username: 'invite.accept' }, '+inviteTokenHash')
      expect(dbUser.invitePending).to.equal(false)
      expect(dbUser.inviteTokenHash).to.equal(undefined)

      const login = await call('post', '/api/v1/login', { body: { username: 'invite.accept', password: goodPassword } })
      expect(login.status).to.equal(200)
      expect(login.body.accessToken).to.be.a('string')
    })

    it('works only once', async function () {
      const r = await call('post', `/api/v2/public/invite/${token}`, { body: { password: goodPassword, passwordConfirm: goodPassword } })
      expect(r.status).to.equal(404)
    })

    it('cannot be re-sent after acceptance', async function () {
      const r = await call('post', '/api/v2/accounts/invite.accept/invite', { token: adminToken })
      expect(r.status).to.equal(400)
    })
  })

  describe('re-sending and expiry', function () {
    it('replaces the previous link', async function () {
      const first = tokenFromUrl((await invite('resend')).body.invite.url)
      const r = await call('post', '/api/v2/accounts/invite.resend/invite', { token: adminToken })
      expect(r.status).to.equal(200)
      const second = tokenFromUrl(r.body.invite.url)
      expect(second).to.not.equal(first)
      expect((await call('get', `/api/v2/public/invite/${first}`)).status).to.equal(404)
      expect((await call('get', `/api/v2/public/invite/${second}`)).status).to.equal(200)
    })

    it('needs accounts:update', async function () {
      const r = await call('post', '/api/v2/accounts/invite.resend/invite')
      expect(r.status).to.be.oneOf([401, 403])
    })

    it('rejects an expired link', async function () {
      const token = tokenFromUrl((await invite('expired')).body.invite.url)
      await userSchema.updateOne({ username: 'invite.expired' }, { inviteExpire: new Date(Date.now() - 1000) })
      expect((await call('get', `/api/v2/public/invite/${token}`)).status).to.equal(404)
    })
  })

  describe('password reset', function () {
    const resetPassword = 'Zurueckgesetzt-2026!'
    let user

    before(async function () {
      user = await userSchema.create({
        username: 'invite.reset',
        password: goodPassword,
        fullname: 'Invite Reset',
        email: 'invite.reset@trudesk.io',
        role: global.userRoleId
      })
      createdIds.push(user._id)
    })

    it('answers 200 for unknown and known addresses alike', async function () {
      const unknown = await call('post', '/api/v2/public/password-reset', { body: { email: 'nobody@trudesk.io' } })
      expect(unknown.status).to.equal(200)
      const known = await call('post', '/api/v2/public/password-reset', { body: { email: 'Invite.Reset@trudesk.io' } })
      expect(known.status).to.equal(200)

      // The link is issued after the response; give it a moment.
      let dbUser
      for (let i = 0; i < 20; i++) {
        dbUser = await userSchema.findOne({ _id: user._id }, '+resetPassHash +resetPassExpire')
        if (dbUser.resetPassHash) break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(dbUser.resetPassHash).to.match(/^[a-f0-9]{64}$/)
      const minutes = (dbUser.resetPassExpire - Date.now()) / 60000
      expect(minutes).to.be.within(59, 60.1)
    })

    it('the web form answers 200 for unknown addresses too', async function () {
      const r = await new Promise(resolve => {
        superagent
          .post(baseUrl + '/forgotpass')
          .type('form')
          .send({ 'forgotPass-email': 'nobody@trudesk.io' })
          .ok(() => true)
          .end((err, res) => resolve(err ? { status: err.status } : res))
      })
      expect(r.status).to.equal(200)
    })

    it('sets a new password and signs out every device', async function () {
      const login = await call('post', '/api/v1/login', { body: { username: 'invite.reset', password: goodPassword, deviceId: 'dev-1' } })
      expect(login.status).to.equal(200)
      const oldToken = login.body.accessToken

      const dbUser = await userSchema.findOne({ _id: user._id })
      const link = await accountTokens.issueReset(dbUser)
      await dbUser.save()
      const token = tokenFromUrl(link.url)
      expect(link.url).to.contain('/passwort-zuruecksetzen/')

      expect((await call('get', `/api/v2/public/password-reset/${token}`)).body.account.username).to.equal('invite.reset')
      const r = await call('post', `/api/v2/public/password-reset/${token}`, {
        body: { password: resetPassword, passwordConfirm: resetPassword }
      })
      expect(r.status, JSON.stringify(r.body)).to.equal(200)

      const oldTokenUse = await call('get', '/api/v1/login', { token: oldToken })
      expect(oldTokenUse.status).to.equal(401)
      expect((await call('post', '/api/v1/login', { body: { username: 'invite.reset', password: goodPassword } })).status).to.equal(401)
      expect((await call('post', '/api/v1/login', { body: { username: 'invite.reset', password: resetPassword } })).status).to.equal(200)
      expect((await call('get', `/api/v2/public/password-reset/${token}`)).status).to.equal(404)
    })

    it('forwards old /resetpassword links to the PWA page', async function () {
      const r = await call('get', '/resetpassword/OLDHASH', { redirects: 0 })
      expect(r.status).to.equal(302)
      expect(r.headers.location).to.match(/\/app\/passwort-zuruecksetzen\/OLDHASH$/)
    })
  })

  it('refuses API login for deleted accounts', async function () {
    const deleted = await userSchema.create({
      username: 'invite.deleted',
      password: goodPassword,
      fullname: 'Invite Deleted',
      email: 'invite.deleted@trudesk.io',
      role: global.userRoleId,
      deleted: true
    })
    createdIds.push(deleted._id)
    const v1 = await call('post', '/api/v1/login', { body: { username: 'invite.deleted', password: goodPassword } })
    expect(v1.status).to.equal(401)
    const v2 = await call('post', '/api/v2/login', { body: { username: 'invite.deleted', password: goodPassword } })
    expect(v2.status).to.equal(401)
  })
})

/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')
const sinon = require('sinon')

const simplewebauthn = require('../../src/helpers/webauthnLib')
const userSchema = require('../../src/models/user')

// Server-side WebAuthn verification (#205): a passkey unlock/login now
// requires a fresh, server-checked signature and mints a genuinely new
// token, instead of the old client-only scheme that just replayed a
// stashed token after a purely local biometric prompt.
//
// verifyRegistrationResponse/verifyAuthenticationResponse are stubbed —
// fabricating a real signed WebAuthn ceremony (CBOR attestation object,
// ECDSA signature) isn't practical here and would just be re-testing
// @simplewebauthn/server's own well-tested crypto. What this controller
// owns — and what these tests actually exercise — is challenge issuance/
// expiry, credential storage, username-enumeration safety, and wiring the
// verified result into a real token via apiUtils.generateJWTToken.
describe('api/v2/webauthn.js', function () {
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  afterEach(function () {
    sinon.restore()
  })

  function authed (method, path) {
    return superagent[method](baseUrl + path).set('accesstoken', adminToken).ok(() => true)
  }

  function anon (method, path) {
    return superagent[method](baseUrl + path).ok(() => true)
  }

  describe('registration (authenticated)', function () {
    afterEach(async function () {
      // Leave no credentials behind between tests.
      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials')
      user.webauthnCredentials = []
      user.webauthnChallenge = undefined
      await user.save()
    })

    it('registrationOptions returns a challenge and stashes it on the user', async function () {
      const res = await authed('post', '/api/v2/webauthn/register/options').send({})

      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.options.challenge).to.be.a('string')
      expect(res.body.options.rp.id).to.equal('localhost')

      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnChallenge')
      expect(user.webauthnChallenge.value).to.equal(res.body.options.challenge)
    })

    it('registrationVerify stores the credential on a verified response', async function () {
      await authed('post', '/api/v2/webauthn/register/options').send({})

      sinon.stub(simplewebauthn, 'verifyRegistrationResponse').resolves({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred-abc',
            publicKey: Buffer.from('fake-public-key-bytes'),
            counter: 0,
            transports: ['internal']
          }
        }
      })

      const res = await authed('post', '/api/v2/webauthn/register/verify').send({
        response: { id: 'cred-abc' },
        deviceLabel: 'Test Device'
      })

      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true

      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials +webauthnChallenge')
      expect(user.webauthnCredentials).to.have.lengthOf(1)
      expect(user.webauthnCredentials[0].credentialId).to.equal('cred-abc')
      expect(user.webauthnCredentials[0].deviceLabel).to.equal('Test Device')
      expect(user.webauthnChallenge).to.not.exist
    })

    it('registrationVerify rejects when the library reports unverified', async function () {
      await authed('post', '/api/v2/webauthn/register/options').send({})
      sinon.stub(simplewebauthn, 'verifyRegistrationResponse').resolves({ verified: false })

      const res = await authed('post', '/api/v2/webauthn/register/verify').send({ response: { id: 'cred-x' } })

      expect(res.status).to.equal(400)
      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials')
      expect(user.webauthnCredentials).to.have.lengthOf(0)
    })

    it('registrationVerify rejects without a prior registrationOptions call', async function () {
      const res = await authed('post', '/api/v2/webauthn/register/verify').send({ response: { id: 'cred-x' } })
      expect(res.status).to.equal(400)
    })

    it('registrationVerify rejects an expired challenge', async function () {
      await authed('post', '/api/v2/webauthn/register/options').send({})
      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnChallenge')
      user.webauthnChallenge.expiresAt = new Date(Date.now() - 1000)
      await user.save()

      const res = await authed('post', '/api/v2/webauthn/register/verify').send({ response: { id: 'cred-x' } })
      expect(res.status).to.equal(400)
    })

    it('rejects unauthenticated requests', async function () {
      const res = await anon('post', '/api/v2/webauthn/register/options').send({})
      expect(res.status).to.not.equal(200)
    })
  })

  describe('credential list + remove (authenticated)', function () {
    beforeEach(async function () {
      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials')
      user.webauthnCredentials = []
      await user.addWebauthnCredential({
        credentialId: 'cred-list-1',
        publicKey: Buffer.from('pk').toString('base64url'),
        counter: 3,
        transports: ['internal'],
        deviceLabel: 'Laptop'
      })
    })

    afterEach(async function () {
      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials')
      user.webauthnCredentials = []
      await user.save()
    })

    it('listCredentials omits key material', async function () {
      const res = await authed('get', '/api/v2/webauthn/credentials')

      expect(res.status).to.equal(200)
      expect(res.body.credentials).to.have.lengthOf(1)
      expect(res.body.credentials[0].credentialId).to.equal('cred-list-1')
      expect(res.body.credentials[0].deviceLabel).to.equal('Laptop')
      expect(res.body.credentials[0]).to.not.have.property('publicKey')
      expect(res.body.credentials[0]).to.not.have.property('counter')
    })

    it('removeCredential deletes the matching entry', async function () {
      const res = await authed('delete', '/api/v2/webauthn/credentials/cred-list-1')
      expect(res.status).to.equal(200)

      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials')
      expect(user.webauthnCredentials).to.have.lengthOf(0)
    })
  })

  describe('authentication (public)', function () {
    beforeEach(async function () {
      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials')
      user.webauthnCredentials = []
      await user.addWebauthnCredential({
        credentialId: 'cred-auth-1',
        publicKey: Buffer.from('pk').toString('base64url'),
        counter: 5,
        transports: ['internal']
      })
    })

    afterEach(async function () {
      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials')
      user.webauthnCredentials = []
      user.webauthnChallenge = undefined
      await user.save()
    })

    it('authenticationOptions returns allowCredentials for a real username', async function () {
      const res = await anon('post', '/api/v2/webauthn/auth/options').send({ username: 'trudesk' })

      expect(res.status).to.equal(200)
      expect(res.body.options.allowCredentials).to.have.lengthOf(1)
      expect(res.body.options.allowCredentials[0].id).to.equal('cred-auth-1')
    })

    it('authenticationOptions returns the same shape for a nonexistent username (no enumeration)', async function () {
      const real = await anon('post', '/api/v2/webauthn/auth/options').send({ username: 'trudesk' })
      const fake = await anon('post', '/api/v2/webauthn/auth/options').send({ username: 'no-such-user-xyz' })

      expect(fake.status).to.equal(real.status)
      expect(Object.keys(fake.body).sort()).to.deep.equal(Object.keys(real.body).sort())
      expect(fake.body.options.allowCredentials).to.have.lengthOf(0)
    })

    it('authenticationVerify mints a fresh token on a verified response', async function () {
      await anon('post', '/api/v2/webauthn/auth/options').send({ username: 'trudesk' })

      sinon.stub(simplewebauthn, 'verifyAuthenticationResponse').resolves({
        verified: true,
        authenticationInfo: { newCounter: 6 }
      })

      const res = await anon('post', '/api/v2/webauthn/auth/verify').send({
        username: 'trudesk',
        response: { id: 'cred-auth-1' }
      })

      expect(res.status).to.equal(200)
      expect(res.body.success).to.be.true
      expect(res.body.token).to.be.a('string')

      const user = await userSchema.findOne({ username: 'trudesk' }).select('+webauthnCredentials +webauthnChallenge')
      expect(user.webauthnCredentials[0].counter).to.equal(6)
      expect(user.webauthnChallenge).to.not.exist
    })

    it('authenticationVerify rejects when the credential belongs to a different username', async function () {
      await anon('post', '/api/v2/webauthn/auth/options').send({ username: 'trudesk' })

      const res = await anon('post', '/api/v2/webauthn/auth/verify').send({
        username: 'someone-else',
        response: { id: 'cred-auth-1' }
      })

      expect(res.status).to.equal(401)
    })

    it('authenticationVerify rejects an unknown credential id', async function () {
      const res = await anon('post', '/api/v2/webauthn/auth/verify').send({
        username: 'trudesk',
        response: { id: 'cred-does-not-exist' }
      })
      expect(res.status).to.equal(401)
    })

    it('authenticationVerify rejects without a prior options call (no challenge)', async function () {
      const res = await anon('post', '/api/v2/webauthn/auth/verify').send({
        username: 'trudesk',
        response: { id: 'cred-auth-1' }
      })
      expect(res.status).to.equal(401)
    })

    it('authenticationVerify rejects when the library reports unverified', async function () {
      await anon('post', '/api/v2/webauthn/auth/options').send({ username: 'trudesk' })
      sinon.stub(simplewebauthn, 'verifyAuthenticationResponse').resolves({ verified: false })

      const res = await anon('post', '/api/v2/webauthn/auth/verify').send({
        username: 'trudesk',
        response: { id: 'cred-auth-1' }
      })

      expect(res.status).to.equal(401)
    })
  })
})

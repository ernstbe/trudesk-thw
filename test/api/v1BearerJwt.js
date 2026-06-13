/* globals server */
const request = require('supertest')

/**
 * v1 auth middleware (middleware.api) now mirrors apiv2's acceptance
 * order: a session user, OR a Bearer JWT, OR the legacy accesstoken
 * header. This lets a pure-JWT client (the PWA after the v2/JWT
 * migration) reach v1-only routes that were never re-mounted under v2.
 * The legacy accesstoken behavior must stay 100% intact.
 */
describe('api/v1 Bearer JWT auth', function () {
  const userSchema = require('../../src/models/user')
  const apiUtils = require('../../src/controllers/api/apiUtils')

  async function jwtFor (username) {
    const user = await userSchema.findOne({ username }).select('+accessToken')
    const { token } = await apiUtils.generateJWTToken(user)
    return token
  }

  it('accepts a Bearer JWT on a v1-only route (200)', async function () {
    const token = await jwtFor('fake.user')
    await request(server).get('/api/v1/tickets/1000').set('Authorization', 'Bearer ' + token).expect(200)
  })

  it('still accepts the legacy accesstoken header (200)', async function () {
    const user = await userSchema.findOne({ username: 'fake.user' }).select('+accessToken')
    if (!user.accessToken) {
      user.accessToken = '456'
      await user.save()
    }
    await request(server).get('/api/v1/tickets/1000').set('accesstoken', '456').expect(200)
  })

  it('rejects a request with neither JWT nor accesstoken (401)', async function () {
    await request(server).get('/api/v1/tickets/1000').expect(401)
  })

  it('rejects a malformed Bearer JWT (401)', async function () {
    await request(server).get('/api/v1/tickets/1000').set('Authorization', 'Bearer not.a.real.token').expect(401)
  })
})

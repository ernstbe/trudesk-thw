/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')

// Self-service avatar upload — POST /api/v2/accounts/profile/picture.
// The endpoint must target the authenticated user (req.user._id), accept
// only images, and store a resized JPEG whose filename it returns.
describe('POST /api/v2/accounts/profile/picture', function () {
  const baseUrl = 'http://localhost:3111'
  // Admin access token seeded by 0_database.js — authenticates as 'trudesk'.
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  // 1x1 PNG — valid input for sharp.
  const onePxPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGD4DwABBAEAfb' +
    'rDwgAAAABJRU5ErkJggg==',
    'base64'
  )

  function upload (token, buf, filename, mime) {
    return new Promise(function (resolve) {
      const req = superagent.post(baseUrl + '/api/v2/accounts/profile/picture')
      if (token) req.set('accesstoken', token)
      req
        .attach('file', buf, { filename, contentType: mime })
        .ok(function () { return true })
        .end(function (err, res) {
          resolve(err ? { status: (err && err.status) || 0, body: {} } : res)
        })
    })
  }

  it('returns 401 without authentication', async function () {
    const res = await upload(null, onePxPng, 'avatar.png', 'image/png')
    expect(res.status).to.equal(401)
  })

  it('stores a resized jpeg and returns its filename for the authed user', async function () {
    const res = await upload(adminToken, onePxPng, 'avatar.png', 'image/png')
    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true
    expect(res.body.image).to.match(/^aProfile_.+\.jpg$/)

    const dbUser = await userSchema.getUserByUsername('trudesk')
    expect(dbUser.image).to.equal(res.body.image)
  })

  it('rejects a non-image file', async function () {
    const res = await upload(adminToken, Buffer.from('not an image'), 'note.txt', 'text/plain')
    expect(res.status).to.equal(400)
  })
})

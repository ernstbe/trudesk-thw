/* eslint-disable no-unused-expressions */
const path = require('path')
const fs = require('fs-extra')
const expect = require('chai').expect
const superagent = require('superagent')

// Regression coverage for GH-145: uploadBackup sanitized the separate
// `object.filename` field (`.replace('/', '').replace('..', '')`) but wrote
// to disk using `object.filePath`, which was built from the RAW multipart
// filename. A traversal filename therefore escaped `backups/` on write even
// though the sanitized `.filename` looked safe. Both filePath and filename
// now come from the same path.basename()'d value.
describe('POST /api/v1/backup/upload — path traversal', function () {
  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
  const backupsDir = path.join(__dirname, '../../backups')
  const escapedTarget = path.join(__dirname, '../../evil-traversal.zip')

  const zipBytes = Buffer.from('PKfake zip content for upload test')

  function upload (filename) {
    return new Promise(function (resolve) {
      superagent
        .post(baseUrl + '/api/v1/backup/upload')
        .set('accesstoken', adminToken)
        .attach('file', zipBytes, { filename, contentType: 'application/zip' })
        .ok(function () { return true })
        .end(function (err, res) {
          resolve(err ? { status: (err && err.status) || 0, body: {} } : res)
        })
    })
  }

  afterEach(async function () {
    await fs.remove(escapedTarget)
    await fs.remove(path.join(backupsDir, 'evil-traversal.zip'))
  })

  it('confines a traversal filename to backups/ instead of escaping it', async function () {
    const res = await upload('../evil-traversal.zip')

    expect(res.status).to.equal(200)
    expect(res.body.success).to.be.true

    expect(await fs.pathExists(escapedTarget)).to.be.false
    expect(await fs.pathExists(path.join(backupsDir, 'evil-traversal.zip'))).to.be.true
  })
})

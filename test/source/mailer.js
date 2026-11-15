const expect = require('chai').expect

const mailer = require('../../src/mailer')

describe('mailer SMTP configuration', function () {
  describe('envConfig', function () {
    it('is off without SMTP_HOST', function () {
      expect(mailer.envConfig({})).to.equal(null)
      expect(mailer.envConfig({ SMTP_HOST: '  ', SMTP_USER: 'x' })).to.equal(null)
    })

    it('defaults to STARTTLS on 587 and uses the login as sender', function () {
      const c = mailer.envConfig({
        SMTP_HOST: 'mail.your-server.de',
        SMTP_USER: 'noreply@example.org',
        SMTP_PASS: 'secret'
      })
      expect(c).to.deep.equal({
        host: 'mail.your-server.de',
        port: 587,
        secure: false,
        user: 'noreply@example.org',
        pass: 'secret',
        from: 'noreply@example.org'
      })
    })

    it('honours SMTP_SECURE, SMTP_PORT and SMTP_FROM', function () {
      const c = mailer.envConfig({
        SMTP_HOST: 'smtp.example.org',
        SMTP_SECURE: 'TRUE',
        SMTP_USER: 'u',
        SMTP_FROM: 'THW Tickets <noreply@example.org>'
      })
      expect(c.secure).to.equal(true)
      expect(c.port).to.equal(465)
      expect(c.from).to.equal('THW Tickets <noreply@example.org>')
      expect(mailer.envConfig({ SMTP_HOST: 'h', SMTP_PORT: '2525' }).port).to.equal(2525)
    })
  })

  describe('transportOptions', function () {
    it('never disables certificate checks', function () {
      const t = mailer.transportOptions({ host: 'h', port: 587, secure: false, user: 'u', pass: 'p' })
      expect(t.tls).to.equal(undefined)
      expect(t.requireTLS).to.equal(true)
      expect(t.auth).to.deep.equal({ user: 'u', pass: 'p' })
    })

    it('does not force STARTTLS on implicit TLS', function () {
      expect(mailer.transportOptions({ host: 'h', port: 465, secure: true }).requireTLS).to.equal(false)
    })

    it('omits auth without a user', function () {
      expect(mailer.transportOptions({ host: 'h', port: 587 }).auth).to.equal(undefined)
    })
  })
})

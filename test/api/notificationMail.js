const expect = require('chai').expect
const superagent = require('superagent')

const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')
const NotificationSchema = require('../../src/models/notification')
const mailer = require('../../src/mailer')
const notificationMail = require('../../src/mailer/notificationMail')

// E-mail copies of ticket notifications: same recipients as in-app/push,
// controlled per user via preferences.emailNotifications.
describe('ticket notification e-mails', function () {
  const baseUrl = 'http://localhost:3111'
  const token = 'notification-mail-token'

  let user
  const notificationIds = []

  before(async function () {
    const userRole = (await roleSchema.getRoles()).find(r => r.normalized === 'user')
    user = await userSchema.create({
      username: 'notifmail.user',
      password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
      fullname: 'Notif Mail',
      email: 'notifmail.user@trudesk.io',
      role: userRole._id,
      accessToken: token
    })
  })

  after(async function () {
    await NotificationSchema.deleteMany({ _id: { $in: notificationIds } })
    await userSchema.deleteOne({ _id: user._id })
  })

  function call (method, path, { auth = true, body } = {}) {
    return new Promise(function (resolve) {
      let req = superagent[method](baseUrl + path).ok(function () { return true })
      if (auth) req = req.set('accesstoken', token)
      if (body) req = req.send(body)
      req.end(function (err, res) { resolve(err ? { status: err.status || 0, body: {} } : res) })
    })
  }

  // Replace mailer.sendMail for one test and collect what would be sent.
  function captureMail () {
    const original = mailer.sendMail
    const sent = []
    mailer.sendMail = function (data, callback) {
      sent.push(data)
      callback(null, { messageId: 'test' })
    }
    return { sent, restore: () => { mailer.sendMail = original } }
  }

  function notification (mailKind, uid = 4711) {
    return {
      owner: user._id,
      title: 't',
      message: 'm',
      mailKind,
      data: { ticket: { uid, subject: 'Pumpe defekt\nbitte prüfen' } }
    }
  }

  describe('preferences', function () {
    it('are off by default (opt-in)', function () {
      expect(notificationMail.emailPrefs({})).to.deep.equal({ personal: false, newTickets: false })
    })

    it('decide per kind', function () {
      const u = { email: 'a@b.c', preferences: { emailNotifications: { personal: false, newTickets: true } } }
      expect(notificationMail.mailKindFor(notification('comment'), u)).to.equal(null)
      expect(notificationMail.mailKindFor(notification('assigned'), u)).to.equal(null)
      expect(notificationMail.mailKindFor(notification('newTicket'), u).headline).to.equal('Neues Ticket')
    })

    it('never mail without kind, ticket, address, or for deleted and pending accounts', function () {
      const u = { email: 'a@b.c', preferences: { emailNotifications: { personal: true } } }
      expect(notificationMail.mailKindFor(notification(undefined), u)).to.equal(null)
      expect(notificationMail.mailKindFor({ mailKind: 'comment', data: {} }, u)).to.equal(null)
      expect(notificationMail.mailKindFor(notification('comment'), { preferences: u.preferences })).to.equal(null)
      expect(notificationMail.mailKindFor(notification('comment'), { ...u, deleted: true })).to.equal(null)
      expect(notificationMail.mailKindFor(notification('comment'), { ...u, invitePending: true })).to.equal(null)
      expect(notificationMail.mailKindFor(notification('comment'), u)).to.not.equal(null)
    })
  })

  describe('sending', function () {
    const optIn = () => userSchema.updateOne({ _id: user._id }, { $set: { 'preferences.emailNotifications.personal': true } })

    afterEach(async function () {
      await userSchema.updateOne({ _id: user._id }, { $unset: { 'preferences.emailNotifications': 1 } })
    })

    it('mails the recipient alone, with a PWA link and no line breaks in the subject', async function () {
      await optIn()
      const capture = captureMail()
      try {
        const ok = await notificationMail.sendForNotification(notification('assigned'))
        expect(ok).to.equal(true)
        expect(capture.sent).to.have.length(1)
        const mail = capture.sent[0]
        expect(mail.to).to.equal('notifmail.user@trudesk.io')
        expect(mail.subject).to.equal('[THW Tickets] #4711 – Ticket dir zugewiesen: Pumpe defekt bitte prüfen')
        expect(mail.html).to.include('/app/tickets/4711')
        expect(mail.html).to.include('/app/settings')
      } finally {
        capture.restore()
      }
    })

    it('sends nothing until the user opts in', async function () {
      const capture = captureMail()
      try {
        expect(await notificationMail.sendForNotification(notification('comment'))).to.equal(false)
        expect(await notificationMail.sendForNotification(notification('newTicket'))).to.equal(false)
        expect(capture.sent).to.have.length(0)
      } finally {
        capture.restore()
      }
    })

    it('stops again after an opt-out', async function () {
      await userSchema.updateOne({ _id: user._id }, { $set: { 'preferences.emailNotifications.personal': false } })
      const capture = captureMail()
      try {
        expect(await notificationMail.sendForNotification(notification('comment'))).to.equal(false)
        expect(capture.sent).to.have.length(0)
      } finally {
        capture.restore()
      }
    })

    it('is triggered by saving a notification with a mailKind only', async function () {
      await optIn()
      const capture = captureMail()
      try {
        const plain = await NotificationSchema.create(notification(undefined))
        const mailed = await NotificationSchema.create(notification('mention', 4712))
        notificationIds.push(plain._id, mailed._id)
        for (let i = 0; i < 50 && capture.sent.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 20))
        expect(capture.sent).to.have.length(1)
        expect(capture.sent[0].subject).to.include('#4712 – Du wurdest erwähnt')
      } finally {
        capture.restore()
      }
    })
  })

  describe('api/v2/accounts/me/notification-settings', function () {
    const path = '/api/v2/accounts/me/notification-settings'

    it('needs a login', async function () {
      const res = await call('get', path, { auth: false })
      expect(res.status).to.equal(401)
    })

    it('returns the defaults and whether mail is available', async function () {
      const res = await call('get', path)
      expect(res.status).to.equal(200)
      expect(res.body.email).to.deep.equal({ personal: false, newTickets: false })
      expect(res.body.mailEnabled).to.equal(false)
    })

    it('updates single switches', async function () {
      const res = await call('put', path, { body: { email: { newTickets: true } } })
      expect(res.status).to.equal(200)
      expect(res.body.email).to.deep.equal({ personal: false, newTickets: true })

      const again = await call('get', path)
      expect(again.body.email.newTickets).to.equal(true)
    })

    it('rejects non-boolean values and empty updates', async function () {
      expect((await call('put', path, { body: { email: { personal: 'yes' } } })).status).to.equal(400)
      expect((await call('put', path, { body: { email: {} } })).status).to.equal(400)
      expect((await call('put', path, { body: {} })).status).to.equal(400)
    })
  })
})

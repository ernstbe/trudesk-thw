/*
 * Invitation and password-reset links (#invite).
 *
 * Both flows hand the user a one-time link into the PWA where they choose
 * their own password:
 *   - invitation:     <pwa>/einladung/<token>               valid 7 days
 *   - password reset: <pwa>/passwort-zuruecksetzen/<token>  valid 1 hour
 *
 * The raw token (32 random bytes, base64url) only ever exists in the link.
 * The database stores its SHA-256, so a leaked backup or DB read cannot be
 * turned into a working link. Tokens are single use: accepting clears the
 * hash, and issuing a new link replaces the previous one.
 */

const crypto = require('crypto')
const path = require('path')
const winston = require('../logger')

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const RESET_TTL_MS = 60 * 60 * 1000
const MIN_PASSWORD_LENGTH = 8
const MAIL_TIMEOUT_MS = 15 * 1000

// 32 bytes base64url without padding = 43 chars.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function hashToken (token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null
  return crypto.createHash('sha256').update(token).digest('hex')
}

function newLinkToken () {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

/**
 * Base URL of the PWA, without trailing slash. In production the trudesk
 * site URL is the admin subdomain (which does not serve the PWA), so the
 * deploy's DOMAIN wins. PWA_BASE_URL overrides both.
 */
async function pwaBaseUrl () {
  if (process.env.PWA_BASE_URL) return process.env.PWA_BASE_URL.replace(/\/+$/, '')
  if (process.env.DOMAIN) return `https://${process.env.DOMAIN}/app`
  const Setting = require('../models/setting')
  const setting = await Setting.getSetting('gen:siteurl')
  const siteUrl = setting && setting.value ? String(setting.value).replace(/\/+$/, '') : ''
  return `${siteUrl}/app`
}

/**
 * Put the account into "invitation pending" state with a fresh link.
 * The caller saves the user. Any previous invite link stops working.
 * @returns {Promise<{ token: string, url: string, expires: Date }>}
 */
async function issueInvite (user) {
  const { token, hash } = newLinkToken()
  const expires = new Date(Date.now() + INVITE_TTL_MS)
  user.invitePending = true
  user.inviteTokenHash = hash
  user.inviteExpire = expires
  return { token, url: `${await pwaBaseUrl()}/einladung/${token}`, expires }
}

/**
 * Attach a fresh password-reset link. The caller saves the user.
 * @returns {Promise<{ token: string, url: string, expires: Date }>}
 */
async function issueReset (user) {
  const { token, hash } = newLinkToken()
  const expires = new Date(Date.now() + RESET_TTL_MS)
  user.resetPassHash = hash
  user.resetPassExpire = expires
  return { token, url: `${await pwaBaseUrl()}/passwort-zuruecksetzen/${token}`, expires }
}

/**
 * Throws an Error with a user-facing (German) message when the password
 * is unacceptable; uses the same complexity setting as account creation.
 */
async function assertAcceptablePassword (password, passwordConfirm) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`)
  }
  if (password !== passwordConfirm) throw new Error('Die Passwörter stimmen nicht überein.')

  const SettingsUtil = require('../settings/settingsUtil')
  const passwordComplexity = require('../settings/passwordComplexity')
  const settingsContent = await SettingsUtil.getSettings()
  const complexity = settingsContent.data.settings.accountsPasswordComplexity
  if (complexity && complexity.value && !passwordComplexity.validate(password)) {
    throw new Error('Das Passwort erfüllt nicht die Anforderungen (Groß- und Kleinbuchstaben, Ziffern und Sonderzeichen).')
  }
}

/**
 * Render and send one of the link mails.
 * @returns {Promise<boolean>} true when the mail went out, false when the
 *   mailer is disabled or sending failed (the admin then shares the link).
 */
async function sendLinkMail ({ user, template, subjectKey, url, expires }) {
  if (!user.email) return false
  try {
    const mailer = require('../mailer')
    const Email = require('email-templates')
    const t = require('../i18n').getFixedT('de')
    const emailRenderer = new Email({
      views: { root: path.resolve(__dirname, '..', 'mailer', 'templates'), options: { extension: 'handlebars' } }
    })
    const html = await emailRenderer.render(template, {
      fullname: user.fullname,
      username: user.username,
      url,
      expires: expires.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })
    })
    let timer
    const info = await Promise.race([
      new Promise((resolve, reject) => {
        mailer.sendMail(
          { to: user.email, subject: t(subjectKey, { siteTitle: 'THW Tickets' }), html, generateTextFromHTML: true },
          (err, result) => (err ? reject(err) : resolve(result))
        )
      }),
      // A hanging SMTP server must not block the admin's request; they get
      // the link to pass on instead.
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('mail send timed out')), MAIL_TIMEOUT_MS)
      })
    ]).finally(() => clearTimeout(timer))
    return info !== 'Mail Disabled'
  } catch (err) {
    winston.warn(`Sending ${template} mail failed: ${err.message}`)
    return false
  }
}

/**
 * Issue and mail a 1-hour reset link for the account with this address.
 * Unknown or deleted addresses are silently ignored; callers must answer
 * the same way either way (no account enumeration).
 */
async function requestPasswordReset (email) {
  if (typeof email !== 'string' || !email.trim()) return
  const User = require('../models/user')
  const user = await User.findOne({ email: email.trim().toLowerCase(), deleted: false })
  if (!user) return
  const link = await issueReset(user)
  await user.save()
  await sendLinkMail({ user, template: 'password-reset', subjectKey: 'passwordResetRequest', url: link.url, expires: link.expires })
}

module.exports = {
  requestPasswordReset,
  INVITE_TTL_MS,
  RESET_TTL_MS,
  MIN_PASSWORD_LENGTH,
  hashToken,
  newLinkToken,
  pwaBaseUrl,
  issueInvite,
  issueReset,
  assertAcceptablePassword,
  sendLinkMail
}

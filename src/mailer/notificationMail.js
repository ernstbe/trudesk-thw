/*
 * E-mail copies of in-app ticket notifications.
 *
 * Every ticket notification is a Notification document; its post-save hook
 * calls sendForNotification() for documents that carry a `mailKind`. That
 * keeps mail recipients identical to in-app/push recipients. Each recipient
 * gets their own mail (no shared To: list) containing only the ticket number
 * and subject, never comment text, plus a link into the PWA.
 */

const path = require('path')
const winston = require('../logger')

const MAIL_TIMEOUT_MS = 15 * 1000
const MAX_SUBJECT_LENGTH = 120

const DEFAULT_PREFS = { personal: true, newTickets: false }

const KINDS = {
  newTicket: {
    pref: 'newTickets',
    headline: 'Neues Ticket',
    intro: 'In einer deiner Gruppen wurde ein neues Ticket erstellt.'
  },
  comment: {
    pref: 'personal',
    headline: 'Neuer Kommentar',
    intro: 'Zu einem Ticket, an dem du beteiligt bist, gibt es einen neuen Kommentar.'
  },
  mention: {
    pref: 'personal',
    headline: 'Du wurdest erwähnt',
    intro: 'Du wurdest in einem Ticket-Kommentar erwähnt.'
  },
  assigned: {
    pref: 'personal',
    headline: 'Ticket dir zugewiesen',
    intro: 'Dir wurde ein Ticket zugewiesen.'
  }
}

/** Effective e-mail preferences of a (lean) user, defaults filled in. */
function emailPrefs (user) {
  const stored = (user && user.preferences && user.preferences.emailNotifications) || {}
  return {
    personal: typeof stored.personal === 'boolean' ? stored.personal : DEFAULT_PREFS.personal,
    newTickets: typeof stored.newTickets === 'boolean' ? stored.newTickets : DEFAULT_PREFS.newTickets
  }
}

/**
 * Whether this notification should produce a mail for this user.
 * @returns {null|{ pref: string, headline: string, intro: string }} the kind, or null
 */
function mailKindFor (notification, user) {
  const kind = KINDS[notification && notification.mailKind]
  if (!kind) return null
  const ticket = notification.data && notification.data.ticket
  if (!ticket || ticket.uid === undefined || ticket.uid === null) return null
  if (!user || !user.email || user.deleted || user.invitePending) return null
  if (!emailPrefs(user)[kind.pref]) return null
  return kind
}

function oneLine (text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * @returns {Promise<boolean>} true when a mail went out
 */
async function sendForNotification (notification) {
  try {
    if (!KINDS[notification.mailKind]) return false
    const User = require('../models/user')
    const user = await User.findById(notification.owner)
      .select('email fullname deleted invitePending preferences.emailNotifications')
      .lean()
    const kind = mailKindFor(notification, user)
    if (!kind) return false

    const mailer = require('./index')
    const { pwaBaseUrl } = require('../helpers/accountTokens')
    const Email = require('email-templates')

    const ticket = notification.data.ticket
    const subject = oneLine(ticket.subject, MAX_SUBJECT_LENGTH)
    const base = await pwaBaseUrl()

    const html = await new Email({
      views: { root: path.resolve(__dirname, 'templates'), options: { extension: 'handlebars' } }
    }).render('ticket-notification', {
      fullname: user.fullname,
      headline: kind.headline,
      intro: kind.intro,
      uid: ticket.uid,
      subject,
      ticketUrl: `${base}/tickets/${ticket.uid}`,
      settingsUrl: `${base}/settings`
    })

    let timer
    const info = await Promise.race([
      new Promise((resolve, reject) => {
        mailer.sendMail(
          {
            to: user.email,
            subject: `[THW Tickets] #${ticket.uid} – ${kind.headline}: ${subject}`,
            html,
            generateTextFromHTML: true
          },
          (err, result) => (err ? reject(err) : resolve(result))
        )
      }),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('mail send timed out')), MAIL_TIMEOUT_MS)
      })
    ]).finally(() => clearTimeout(timer))
    return info !== 'Mail Disabled'
  } catch (err) {
    winston.warn(`Notification mail failed: ${err.message}`)
    return false
  }
}

module.exports = { KINDS, DEFAULT_PREFS, emailPrefs, mailKindFor, sendForNotification }

/*
 *       .                             .o8                     oooo
 *    .o8                             "888                     `888
 *  .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
 *    888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
 *    888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
 *    888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
 *    "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 *  ========================================================================
 *  Author:     Chris Brame
 *  Updated:    1/20/19 4:43 PM
 *  Copyright (c) 2014-2019. All rights reserved.
 */

const nodeMailer = require('nodemailer')

const mailer = {}

/**
 * SMTP configuration from the environment (deploy/.env). This is the only
 * source: the old mailer:* database settings are no longer read, so the SMTP
 * password never ends up in MongoDB or its backups.
 *
 *   SMTP_HOST    required to activate, e.g. mail.your-server.de
 *   SMTP_PORT    default 587 (465 when SMTP_SECURE=true)
 *   SMTP_SECURE  "true" for implicit TLS (port 465); otherwise STARTTLS is
 *                required, so credentials never travel in plain text
 *   SMTP_USER    / SMTP_PASS   login
 *   SMTP_FROM    sender, default SMTP_USER
 *
 * @returns {null|{ host: string, port: number, secure: boolean, user: string, pass: string, from: string }}
 */
mailer.envConfig = function (env = process.env) {
  const host = (env.SMTP_HOST || '').trim()
  if (!host) return null
  const secure = String(env.SMTP_SECURE || '').toLowerCase() === 'true'
  const port = parseInt(env.SMTP_PORT, 10) || (secure ? 465 : 587)
  const user = (env.SMTP_USER || '').trim()
  return {
    host,
    port,
    secure,
    user,
    pass: env.SMTP_PASS || '',
    from: (env.SMTP_FROM || '').trim() || user
  }
}

/**
 * Whether mail can go out at all (SMTP_HOST is set).
 * @returns {Promise<boolean>}
 */
mailer.isEnabled = async function () {
  return !!mailer.envConfig()
}

/**
 * nodemailer transport options. TLS certificates are always verified, and
 * without implicit TLS the server must offer STARTTLS.
 * @param {{ host: string, port: number, secure: boolean, user?: string, pass?: string }} c
 */
mailer.transportOptions = function (c) {
  const transport = {
    host: c.host,
    port: c.port,
    secure: !!c.secure,
    requireTLS: !c.secure
  }
  if (c.user) transport.auth = { user: c.user, pass: c.pass || '' }
  return transport
}

function disabledError () {
  const e = new Error('Mail Disabled')
  e.code = 'Mail Disabled'
  return e
}

/**
 * Send a mail. Calls back with (null, 'Mail Disabled') when no SMTP is
 * configured, so callers can treat "no mail" as a normal outcome.
 */
mailer.sendMail = function (data, callback) {
  const config = mailer.envConfig()
  if (!config) return callback(null, 'Mail Disabled')
  if (!config.from) return callback(new Error('No From Address Set.'))

  data.from = config.from
  nodeMailer.createTransport(mailer.transportOptions(config)).sendMail(data, callback)
}

/** Check the SMTP connection and login (settings page "test" button). */
mailer.verify = function (callback) {
  const config = mailer.envConfig()
  if (!config) return callback(disabledError())

  nodeMailer.createTransport(mailer.transportOptions(config)).verify(function (err) {
    return callback(err || undefined)
  })
}

module.exports = mailer

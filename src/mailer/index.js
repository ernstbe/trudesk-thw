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

const settings = require('../models/setting')

const mailer = {}

mailer.sendMail = function (data, callback) {
  createTransporter(function (err, mailSettings) {
    if (err) return callback(err)
    if (!mailSettings || !mailSettings.enabled) {
      // Mail Disabled
      return callback(null, 'Mail Disabled')
    }

    if (!mailSettings.from) return callback(new Error('No From Address Set.'))

    data.from = mailSettings.from.value

    if (!data.from) return callback(new Error('No From Address Set.'))

    mailSettings.transporter.sendMail(data, callback)
  })
}

mailer.verify = function (callback) {
  createTransporter(function (err, mailSettings) {
    if (err) return callback(err)

    if (!mailSettings.enabled) {
      const e = new Error('Mail Disabled')
      e.code = 'Mail Disabled'
      return callback(e)
    }

    mailSettings.transporter.verify(function (err) {
      if (err) return callback(err)

      return callback()
    })
  })
}

/**
 * SMTP configuration from the environment (deploy/.env). When SMTP_HOST is
 * set it replaces the mailer:* settings from the database entirely, so the
 * SMTP password never has to be stored in MongoDB (or its backups).
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
 * Whether mail can go out at all: SMTP_* in the environment, or the
 * mailer:enable database setting.
 * @returns {Promise<boolean>}
 */
mailer.isEnabled = async function () {
  if (mailer.envConfig()) return true
  const setting = await settings.getSetting('mailer:enable')
  return !!(setting && setting.value)
}

/**
 * nodemailer transport options. TLS certificates are always verified.
 * @param {{ host: string, port: number|string, secure: boolean, user?: string, pass?: string }} c
 * @param {boolean} requireTLS refuse to send when the server offers no STARTTLS
 */
mailer.transportOptions = function (c, requireTLS) {
  const transport = {
    host: c.host || '127.0.0.1',
    port: c.port || 25,
    secure: !!c.secure,
    requireTLS: !c.secure && !!requireTLS
  }
  if (c.user) transport.auth = { user: c.user, pass: c.pass || '' }
  return transport
}

function createTransporter (callback) {
  const env = mailer.envConfig()
  if (env) {
    return finish(callback, {
      enabled: true,
      from: { value: env.from },
      transport: mailer.transportOptions(env, true)
    })
  }

  // Setting.getSettings is promise-based and ignores a callback argument;
  // passing one (as this code used to) meant sendMail never called back.
  settings.getSettings().then(function (s) { buildFromSettings(s, callback) }, callback)
}

function buildFromSettings (s, callback) {
  const value = function (name) {
    const setting = s.find(function (x) {
      return x.name === name
    })
    return setting ? setting.value : undefined
  }

  return finish(callback, {
    enabled: value('mailer:enable') || false,
    from: s.find(function (x) {
      return x.name === 'mailer:from'
    }),
    transport: mailer.transportOptions(
      {
        host: value('mailer:host'),
        port: value('mailer:port'),
        secure: value('mailer:ssl'),
        user: value('mailer:username'),
        pass: value('mailer:password')
      },
      false
    )
  })
}

function finish (callback, mailSettings) {
  mailSettings.transporter = nodeMailer.createTransport(mailSettings.transport)
  delete mailSettings.transport
  mailer.transporter = mailSettings.transporter

  return callback(null, mailSettings)
}

module.exports = mailer

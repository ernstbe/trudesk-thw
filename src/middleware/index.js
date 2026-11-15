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

const path = require('path')
const async = require('async')
const express = require('express')
const expressStaticGzip = require('express-static-gzip')
const mongoose = require('mongoose')
const APC = require('@handlebars/allow-prototype-access')
const HandleBars = require('handlebars')
const insecureHandlebars = APC.allowInsecurePrototypeAccess(HandleBars)
const hbs = require('express-hbs')
const hbsHelpers = require('../helpers/hbs/helpers')
const winston = require('../logger')
const nconf = require('nconf')
const flash = require('connect-flash')
const cookieParser = require('cookie-parser')
const session = require('express-session')
const MongoStore = require('connect-mongo').default || require('connect-mongo').MongoStore
const passportConfig = require('../passport')()

const ANONYMOUS_SESSION_MAX_AGE = 1000 * 60 * 60 * 24 // 1 day
const NO_CSRF_SECRET_PATHS = new Set(['/healthz', '/version', '/login'])

let middleware = {}

module.exports = function (app, db, callback) {
  middleware = require('./middleware')(app)
  app.disable('x-powered-by')
  app.set('query parser', 'extended')

  app.set('views', path.join(__dirname, '../views/'))

  app.engine(
    'hbs',
    hbs.express4({
      handlebars: insecureHandlebars,
      defaultLayout: path.join(__dirname, '../views/layout/main.hbs'),
      partialsDir: [path.join(__dirname, '../views/partials/'), path.join(__dirname, '../views/subviews/reports')]
    })
  )
  app.set('view engine', 'hbs')
  hbsHelpers.register(hbs.handlebars)
  // Required to access handlebars in mail templates
  global.Handlebars = hbs.handlebars

  app.use(express.urlencoded({ limit: '2mb', extended: false }))
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())

  if (global.env === 'production') {
    app.use(
      expressStaticGzip(path.join(__dirname, '../../public'), {
        index: false
      })
    )
  } else app.use(express.static(path.join(__dirname, '../../public')))

  app.use(function (req, res, next) {
    if (mongoose.connection.readyState !== 1) {
      const err = new Error('MongoDb Connection Error')
      err.status = 503

      return res.render('503', { layout: false })
    }

    return next()
  })

  const cookie = {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 365 // 1 year
  }

  const sessionSecret = nconf.get('tokens:secret')
  if (!sessionSecret) {
    throw new Error('Session secret not configured. Set tokens:secret in config.yml or TRUDESK_JWTSECRET environment variable.')
  }

  async.waterfall(
    [
      function (next) {
        try {
          const sessionStore = MongoStore.create({
            client: db.connection.getClient()
          })
          app.use(
            session({
              secret: sessionSecret,
              cookie,
              store: sessionStore,
              saveUninitialized: false,
              resave: false
            })
          )
          next(null, sessionStore)
        } catch (e) {
          next(e)
        }
      },
      function (store, next) {
        app.use(passportConfig.initialize())
        app.use(passportConfig.session())

        // Anonymous sessions only carry a CSRF secret / flash message for the
        // login form, so they don't need the 1-year cookie lifetime. Without
        // this, every cookie-less request (uptime monitors, bots) left a
        // session in MongoDB for a year: 570k+ of them in production. Logging
        // in regenerates the session (passport >= 0.6), so authenticated
        // sessions still get the full maxAge configured above.
        app.use(function (req, res, next) {
          if (!req.user && req.session && req.session.cookie) {
            req.session.cookie.maxAge = ANONYMOUS_SESSION_MAX_AGE
          }
          return next()
        })

        app.use(flash())

        // CORS
        app.use(allowCrossDomain)
        const csrf = require('../dependencies/csrf-td')
        csrf.init()
        // Health checks and the bare GET /login redirect never render a form,
        // so they must not mint a CSRF secret: that write is what creates a
        // new session for every monitor poll.
        app.use(function (req, res, next) {
          if (req.method === 'GET' && NO_CSRF_SECRET_PATHS.has(req.path)) return next()
          return csrf.generateToken(req, res, next)
        })

        // Maintenance Mode
        app.use(function (req, res, next) {
          const settings = require('../settings/settingsUtil')
          settings.getSettings(function (err, setting) {
            if (err) return winston.warn(err)
            const maintenanceMode = setting.data.settings.maintenanceMode

            if (req.user) {
              if (maintenanceMode.value === true && !req.user.role.isAdmin) {
                return res.render('maintenance', { layout: false })
              }
            }

            return next()
          })
        })

        // Mobile - Disable mobile view until rewrite due to a security bug
        // app.use('/mobile', express.static(path.join(__dirname, '../../', 'mobile')))
        app.use('/mobile', (req, res, next) => {
          return res.redirect('/')
        })

        app.use('/assets', express.static(path.join(__dirname, '../../public/uploads/assets')))
        app.use('/uploads/users', express.static(path.join(__dirname, '../../public/uploads/users')))
        app.use('/uploads', middleware.hasAuth, express.static(path.join(__dirname, '../../public/uploads')))
        app.use(
          '/backups',
          middleware.hasAuth,
          middleware.isAdmin,
          express.static(path.join(__dirname, '../../backups'))
        )

        // Uncomment to enable plugins

        return next(null, store)
        // global.plugins = [];
        // var dive = require('dive');
        // dive(path.join(__dirname, '../../plugins'), {directories: true, files: false, recursive: false}, function(err, dir) {
        //    if (err) throw err;
        //    var fs = require('fs');
        //    if (fs.existsSync(path.join(dir, 'plugin.json'))) {
        //        var plugin = require(path.join(dir, 'plugin.json'));
        //        if (!_.isUndefined(_.find(global.plugins, {'name': plugin.name})))
        //            throw new Error('Unable to load plugin with duplicate name: ' + plugin.name);
        //
        //        global.plugins.push({name: plugin.name.toLowerCase(), version: plugin.version});
        //        var pluginPublic = path.join(dir, '/public');
        //        app.use('/plugins/' + plugin.name, express.static(pluginPublic));
        //        winston.debug('Detected Plugin: ' + plugin.name.toLowerCase() + '-' + plugin.version);
        //    }
        // }, function() {
        //     next(null, store);
        // });
      }
    ],
    function (err, s) {
      if (err) {
        winston.error(err)
        throw new Error(err)
      }

      callback(middleware, s)
    }
  )
}

function allowCrossDomain (req, res, next) {
  const originsConfig = nconf.get('ALLOWED_ORIGINS') || nconf.get('allowedOrigins')
  const allowedOrigins = originsConfig
    ? originsConfig.split(',').map(s => s.trim())
    : []
  const origin = req.headers.origin

  if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else if (allowedOrigins.length === 0) {
    // Fallback for dev: allow all origins only when no allowedOrigins configured
    res.setHeader('Access-Control-Allow-Origin', '*')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'DNT,X-Mx-ReqToken,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization,accesstoken,X-RToken,X-Token'
  )
  // Trudesk's admin UI is mostly server-rendered Handlebars with a lot of
  // upstream-legacy inline scripts/styles (and the chart vendor needs eval).
  // The CSP below is intentionally lax on script-src/style-src so the
  // existing admin pages keep working, but locks down everything else.
  // The strict PWA gets its own CSP from nginx.conf in the PWA repo.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data:",
      "connect-src 'self' wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ') + ';'
  )
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
  } else {
    next()
  }
}

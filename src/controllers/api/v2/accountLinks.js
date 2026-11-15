/*
 * Public (unauthenticated) endpoints behind the invitation and
 * password-reset links (#invite). The PWA pages /einladung/<token> and
 * /passwort-zuruecksetzen/<token> call these.
 *
 * All routes are IP rate limited (rateLimits.accountLink). Invalid,
 * expired and already-used links get the same 404, and the reset request
 * answers 200 whether or not the address exists, so none of them can be
 * used to probe for accounts.
 */

const winston = require('../../../logger')
const apiUtils = require('../apiUtils')
const User = require('../../../models/user')
const accountTokens = require('../../../helpers/accountTokens')

const INVALID_LINK = 'Der Link ist ungültig oder abgelaufen.'

const accountLinks = {}

function kindFromPath (req) {
  return req.path.indexOf('/public/invite/') !== -1 ? 'invite' : 'reset'
}

async function findByLink (req) {
  const tokenHash = accountTokens.hashToken(req.params.token)
  if (!tokenHash) return null
  return User.getUserByLinkTokenHash(kindFromPath(req), tokenHash)
}

// GET /api/v2/public/invite/:token and /api/v2/public/password-reset/:token
// Lets the PWA show who the link is for before asking for a password.
accountLinks.check = async function (req, res) {
  try {
    const user = await findByLink(req)
    if (!user) return apiUtils.sendApiError(res, 404, INVALID_LINK)
    return apiUtils.sendApiSuccess(res, { account: { fullname: user.fullname, username: user.username } })
  } catch (err) {
    winston.warn(err)
    return apiUtils.sendApiError(res, 500, 'Interner Fehler')
  }
}

// POST /api/v2/public/invite/:token and /api/v2/public/password-reset/:token
// Body: { password, passwordConfirm }. Sets the password, consumes the
// link and returns the username so the PWA can log straight in.
accountLinks.accept = async function (req, res) {
  const body = req.body || {}
  try {
    const user = await findByLink(req)
    if (!user) return apiUtils.sendApiError(res, 404, INVALID_LINK)

    try {
      await accountTokens.assertAcceptablePassword(body.password, body.passwordConfirm)
    } catch (validationErr) {
      return apiUtils.sendApiError(res, 400, validationErr.message)
    }

    const isReset = kindFromPath(req) === 'reset'

    user.password = body.password
    // Either link proves control of the mailbox, so both clear both.
    user.invitePending = false
    user.inviteTokenHash = undefined
    user.inviteExpire = undefined
    user.resetPassHash = undefined
    user.resetPassExpire = undefined
    await user.save()

    if (isReset) {
      // Someone may have known the old password: sign out every device.
      await user.removeAccessToken()
      const Session = require('../../../models/session')
      await Session.destroy(user._id)
    }

    return apiUtils.sendApiSuccess(res, { username: user.username })
  } catch (err) {
    winston.warn(err)
    return apiUtils.sendApiError(res, 500, 'Interner Fehler')
  }
}

// POST /api/v2/public/password-reset  Body: { email }
// Always 200. The lookup and mail run after the response is sent so the
// response time does not reveal whether the address exists either.
accountLinks.requestReset = function (req, res) {
  const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim() : ''
  if (!email || email.length > 254) return apiUtils.sendApiError_InvalidPostData(res)

  apiUtils.sendApiSuccess(res, {})

  setImmediate(() => {
    accountTokens
      .requestPasswordReset(email)
      .catch(err => winston.warn(`Password reset request failed: ${err.message}`))
  })
}

module.exports = accountLinks

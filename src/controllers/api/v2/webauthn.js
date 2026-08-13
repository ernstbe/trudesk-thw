/*
 *       .                             .o8                     oooo
 *    .o8                             "888                     `888
 *  .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
 *    888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
 *    888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
 *    888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
 *    "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 *  ========================================================================
 *  Server-verified WebAuthn/passkey registration + authentication (#205).
 */

// Via the wrapper (not @simplewebauthn/server directly) so tests can
// sinon.stub() the individual functions — the real crypto verification is
// @simplewebauthn/server's job, already tested upstream; what this
// controller owns is challenge/credential storage and wiring.
const simplewebauthn = require('../../../helpers/webauthnLib')
const nconf = require('nconf')
const User = require('../../../models/user')
const apiUtils = require('../apiUtils')
const logger = require('../../../logger')

const webauthnApi = {}

// A user can only be mid-ceremony once, so both registration and
// authentication reuse the same scratch field on the user doc rather than
// needing a separate TTL-indexed collection.
const CHALLENGE_TTL_MS = 5 * 60 * 1000

// req.headers.host/Origin are attacker-controllable, so verification needs
// a known-good expected origin/RP ID from config — NOT derived from the
// request. The header-derived fallback below only exists so a fresh/dev
// install doesn't hard-crash; it is NOT a safe default for production and
// logs loudly every time it's hit.
function getRpConfig (req) {
  const cfg = nconf.get('webauthn')
  if (cfg && cfg.rpId && cfg.origin) {
    return { rpID: cfg.rpId, rpName: cfg.rpName || 'Trudesk', origin: cfg.origin }
  }

  logger.warn(
    'webauthn: rpId/origin not configured (config.yml "webauthn" block) — falling back to the request Host ' +
      'header. This is INSECURE (Host is attacker-controllable) and must not be relied on in production.'
  )
  const host = req.headers.host || 'localhost'
  return { rpID: host.split(':')[0], rpName: 'Trudesk', origin: `${req.protocol}://${host}` }
}

function challengeValid (challenge) {
  return !!(challenge && challenge.value && challenge.expiresAt && new Date(challenge.expiresAt) > new Date())
}

// req.user for a JWT-authenticated request is the decoded token payload
// (a plain object, no Mongoose instance methods) — never a live document.
// Every handler that needs to mutate the user re-fetches by id, same
// pattern as ticketsV2.create (v2/tickets.js).
webauthnApi.registrationOptions = async function (req, res) {
  try {
    const user = await User.findById(req.user._id).select('+webauthnCredentials')
    if (!user) return apiUtils.sendApiError(res, 401, 'Invalid User')

    const { rpID, rpName } = getRpConfig(req)
    const options = await simplewebauthn.generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.username,
      userDisplayName: user.fullname,
      userID: Buffer.from(user._id.toString()),
      attestationType: 'none',
      excludeCredentials: (user.webauthnCredentials || []).map((c) => ({
        id: c.credentialId,
        transports: c.transports
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }
    })

    user.webauthnChallenge = { value: options.challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) }
    await user.save()

    return apiUtils.sendApiSuccess(res, { options })
  } catch (e) {
    return apiUtils.sendApiError(res, 500, e.message)
  }
}

webauthnApi.registrationVerify = async function (req, res) {
  try {
    const user = await User.findById(req.user._id).select('+webauthnCredentials +webauthnChallenge')
    if (!user) return apiUtils.sendApiError(res, 401, 'Invalid User')

    if (!challengeValid(user.webauthnChallenge)) {
      return apiUtils.sendApiError(res, 400, 'No pending registration challenge (expired or not started)')
    }

    const { rpID, origin } = getRpConfig(req)
    const verification = await simplewebauthn.verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: user.webauthnChallenge.value,
      expectedOrigin: origin,
      expectedRPID: rpID
    })

    if (!verification.verified || !verification.registrationInfo) {
      return apiUtils.sendApiError(res, 400, 'Registration verification failed')
    }

    const { credential } = verification.registrationInfo
    user.webauthnChallenge = undefined
    await user.addWebauthnCredential({
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || [],
      deviceLabel: req.body.deviceLabel
    })

    return apiUtils.sendApiSuccess(res)
  } catch (e) {
    return apiUtils.sendApiError(res, 500, e.message)
  }
}

webauthnApi.removeCredential = async function (req, res) {
  try {
    const credentialId = req.params.credentialId
    if (!credentialId) return apiUtils.sendApiError_InvalidPostData(res)

    const user = await User.findById(req.user._id).select('+webauthnCredentials')
    if (!user) return apiUtils.sendApiError(res, 401, 'Invalid User')

    await user.removeWebauthnCredential(credentialId)

    return apiUtils.sendApiSuccess(res)
  } catch (e) {
    return apiUtils.sendApiError(res, 500, e.message)
  }
}

webauthnApi.listCredentials = async function (req, res) {
  try {
    const user = await User.findById(req.user._id).select('+webauthnCredentials')
    if (!user) return apiUtils.sendApiError(res, 401, 'Invalid User')

    // No key material (publicKey/counter) leaves the server.
    const credentials = (user.webauthnCredentials || []).map((c) => ({
      credentialId: c.credentialId,
      deviceLabel: c.deviceLabel,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt
    }))

    return apiUtils.sendApiSuccess(res, { credentials })
  } catch (e) {
    return apiUtils.sendApiError(res, 500, e.message)
  }
}

// --- Public (unauthenticated) endpoints: the whole point is signing in ---

webauthnApi.authenticationOptions = async function (req, res) {
  try {
    const username = req.body.username
    if (!username) return apiUtils.sendApiError_InvalidPostData(res)

    const user = await User.findOne({ username: String(username).toLowerCase(), deleted: false }).select(
      '+webauthnCredentials'
    )

    const { rpID } = getRpConfig(req)
    const allowCredentials = user
      ? (user.webauthnCredentials || []).map((c) => ({ id: c.credentialId, transports: c.transports }))
      : []

    const options = await simplewebauthn.generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred'
    })

    // Same response shape whether or not the account exists, so this
    // endpoint can't be used to enumerate usernames. A nonexistent user has
    // no doc to stash the challenge on, so the later verify step simply
    // has nothing to match — same net effect as a bad credential.
    if (user) {
      user.webauthnChallenge = { value: options.challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) }
      await user.save()
    }

    return apiUtils.sendApiSuccess(res, { options })
  } catch (e) {
    return apiUtils.sendApiError(res, 500, e.message)
  }
}

webauthnApi.authenticationVerify = async function (req, res) {
  try {
    const username = req.body.username
    const response = req.body.response
    if (!username || !response || !response.id) return apiUtils.sendApiError_InvalidPostData(res)

    const user = await User.getUserByWebauthnCredentialId(response.id)
    if (!user || user.username !== String(username).toLowerCase()) {
      return apiUtils.sendApiError(res, 401, 'Invalid Credential')
    }

    if (!challengeValid(user.webauthnChallenge)) {
      return apiUtils.sendApiError(res, 401, 'Challenge expired or not found')
    }

    const stored = (user.webauthnCredentials || []).find((c) => c.credentialId === response.id)
    if (!stored) return apiUtils.sendApiError(res, 401, 'Invalid Credential')

    const { rpID, origin } = getRpConfig(req)
    const verification = await simplewebauthn.verifyAuthenticationResponse({
      response,
      expectedChallenge: user.webauthnChallenge.value,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.credentialId,
        publicKey: Buffer.from(stored.publicKey, 'base64url'),
        counter: stored.counter,
        transports: stored.transports
      }
    })

    if (!verification.verified) {
      return apiUtils.sendApiError(res, 401, 'Authentication verification failed')
    }

    stored.counter = verification.authenticationInfo.newCounter
    stored.lastUsedAt = new Date()
    user.webauthnChallenge = undefined
    await user.save()

    const tokens = await apiUtils.generateJWTToken(user)
    return apiUtils.sendApiSuccess(res, { token: tokens.token, refreshToken: tokens.refreshToken })
  } catch (e) {
    return apiUtils.sendApiError(res, 500, e.message)
  }
}

module.exports = webauthnApi

/*
 * Sessions controller — Phase 3 of the multi-device token rollout (#51).
 *
 * Exposes the per-user list of active access-token entries so the PWA
 * can render an "Active sessions" page in the profile, and lets the
 * user revoke one (logout-that-device) or all-but-current (sign out
 * everywhere except here).
 *
 * Token values themselves are NEVER returned to the client — only
 * metadata. Even the user inspecting their own sessions shouldn't be
 * able to read back the raw token strings (would defeat the point of
 * select:false on the schema and make XSS leaks worse).
 */

const sessions = {}

/**
 * GET /api/v1/account/sessions
 *
 * Returns the list of active per-device sessions for the authenticated
 * user. Includes the legacy single-token field (if still set) as a
 * synthetic "legacy" entry so the UI can offer to retire it. Marks the
 * entry that the current request authenticated with so the UI can show
 * "this device" and protect it from accidental revocation.
 */
sessions.list = async function (req, res) {
  const userSchema = require('../../../models/user')
  try {
    // req.user comes from middleware.api which loaded the user via
    // getUserByAccessToken — that selects accessTokens so it's already
    // populated. Re-fetch defensively in case downstream middleware
    // dropped the field.
    const user = await userSchema.findById(req.user._id).select('+accessToken +accessTokens').exec()
    if (!user) return res.status(404).json({ success: false, error: 'User not found' })

    // Under a pure-JWT auth path there's no accesstoken header, but the
    // JWT carries the same value as a `_sessionToken` claim (see
    // passport/index.js) — fall back to that so "this device" still
    // resolves correctly instead of degrading to isCurrent: false.
    const currentToken = req.headers.accesstoken || (req.user && req.user._sessionToken)
    const entries = []

    if (Array.isArray(user.accessTokens)) {
      for (const t of user.accessTokens) {
        entries.push({
          deviceId: t.deviceId || null,
          userAgent: t.userAgent || null,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt,
          isCurrent: t.token === currentToken
        })
      }
    }

    if (user.accessToken) {
      entries.push({
        deviceId: null,
        userAgent: null,
        createdAt: null,
        lastUsedAt: null,
        isCurrent: user.accessToken === currentToken,
        isLegacy: true
      })
    }

    return res.json({ success: true, sessions: entries })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * DELETE /api/v1/account/sessions/:deviceId
 *
 * Revokes the session for a given deviceId belonging to the
 * authenticated user. Returns 404 if no such device entry exists.
 * Refusing to revoke "current" is the client's job — the server lets
 * you shoot your own foot if you want.
 */
sessions.revoke = async function (req, res) {
  const userSchema = require('../../../models/user')
  const deviceId = req.params.deviceId
  if (!deviceId) return res.status(400).json({ success: false, error: 'Missing deviceId' })

  try {
    const user = await userSchema.findById(req.user._id).select('+accessToken +accessTokens').exec()
    if (!user) return res.status(404).json({ success: false, error: 'User not found' })

    if (!Array.isArray(user.accessTokens) || user.accessTokens.length === 0) {
      return res.status(404).json({ success: false, error: 'No such session' })
    }

    const before = user.accessTokens.length
    user.accessTokens = user.accessTokens.filter((t) => t.deviceId !== deviceId)
    if (user.accessTokens.length === before) {
      return res.status(404).json({ success: false, error: 'No such session' })
    }

    await user.save()
    return res.json({ success: true })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * DELETE /api/v1/account/sessions
 *
 * Revokes every session EXCEPT the one authenticating this request.
 * Use case: user suspects compromise, wants to nuke other devices but
 * not log themselves out. Also clears the legacy `accessToken` field
 * because a leaked legacy token is the very thing this endpoint should
 * mitigate.
 */
sessions.revokeOthers = async function (req, res) {
  const userSchema = require('../../../models/user')
  // Same fallback as list(): a JWT-authenticated request has no accesstoken
  // header, but carries the equivalent value as req.user._sessionToken.
  const currentToken = req.headers.accesstoken || (req.user && req.user._sessionToken)

  try {
    const user = await userSchema.findById(req.user._id).select('+accessToken +accessTokens').exec()
    if (!user) return res.status(404).json({ success: false, error: 'User not found' })

    if (!currentToken) {
      // Can't identify which session this request is — e.g. a JWT issued
      // before this session-token claim existed. Degrade instead of
      // hard-failing: report success without revoking anything, rather
      // than risk logging the caller out of the very session they're
      // using right now by guessing wrong.
      return res.json({ success: true, degraded: true, revokedCount: 0 })
    }

    let revokedCount = 0
    if (Array.isArray(user.accessTokens)) {
      const before = user.accessTokens.length
      user.accessTokens = user.accessTokens.filter((t) => t.token === currentToken)
      revokedCount += before - user.accessTokens.length
    }

    // Wipe the legacy single field unless that's literally what we're
    // currently using — in which case keep it so this request's caller
    // doesn't lock themselves out mid-call.
    if (user.accessToken && user.accessToken !== currentToken) {
      user.accessToken = undefined
      revokedCount += 1
    }

    await user.save()
    return res.json({ success: true, revokedCount })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

module.exports = sessions

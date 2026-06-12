const sanitizeHtml = require('sanitize-html')

const MAX_ITEMS = 100
const MAX_TITLE_LENGTH = 500

// sanitize-html entity-encodes the remaining text (& -> &amp;). The titles are
// stored and rendered as plain text, so decode the standard entities back.
// NOTE: &amp; must be decoded last, otherwise encoded entities get double-decoded.
function decodeEntities (str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

// Parses a checklist payload into plain-text items.
// Returns { ok: true, checklist } or { ok: false, error }.
// Items without a non-empty string title are dropped.
function parseChecklist (input) {
  if (!Array.isArray(input)) return { ok: false, error: 'Invalid Parameters: checklist must be an array' }
  if (input.length > MAX_ITEMS) {
    return { ok: false, error: 'Invalid Parameters: checklist exceeds maximum of ' + MAX_ITEMS + ' items' }
  }

  const checklist = []
  for (let i = 0; i < input.length; i++) {
    const item = input[i]
    if (!item || typeof item !== 'object' || typeof item.title !== 'string') continue

    const title = decodeEntities(sanitizeHtml(item.title, { allowedTags: [], allowedAttributes: {} })).trim()
    if (title.length < 1) continue
    if (title.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: 'Invalid Parameters: checklist item title exceeds ' + MAX_TITLE_LENGTH + ' characters' }
    }

    checklist.push({ title })
  }

  return { ok: true, checklist }
}

// Convenience wrapper for optional checklist fields on post data.
// undefined means the field was not sent and should be left untouched.
function parseChecklistField (value) {
  if (value === undefined) return { ok: true, checklist: undefined }
  return parseChecklist(value)
}

module.exports = { parseChecklist, parseChecklistField, decodeEntities }

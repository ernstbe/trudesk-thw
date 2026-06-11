const sanitizeHtml = require('sanitize-html')

// Returns a sanitized checklist array or null if the input is not an array.
// Items without a non-empty string title are dropped.
function parseChecklist (input) {
  if (!Array.isArray(input)) return null

  const checklist = []
  for (let i = 0; i < input.length; i++) {
    const item = input[i]
    if (!item || typeof item !== 'object' || typeof item.title !== 'string') continue

    const title = sanitizeHtml(item.title).trim()
    if (title.length < 1) continue

    checklist.push({ title })
  }

  return checklist
}

module.exports = parseChecklist

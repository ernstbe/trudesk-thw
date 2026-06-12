/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const { parseChecklist, parseChecklistField } = require('../../src/controllers/api/v2/checklistParser')

describe('src/controllers/api/v2/checklistParser.js', function () {
  it('should reject non-array input', function () {
    const result = parseChecklist('garbage')
    expect(result.ok).to.be.false
    expect(result.error).to.contain('must be an array')
  })

  it('should strip html tags and store plain text', function () {
    const result = parseChecklist([{ title: '<b>Filter pruefen</b>' }])
    expect(result.ok).to.be.true
    expect(result.checklist).to.have.length(1)
    expect(result.checklist[0].title).to.equal('Filter pruefen')
  })

  it('should not entity-encode plain text', function () {
    const result = parseChecklist([{ title: 'Oel & Filter' }])
    expect(result.ok).to.be.true
    expect(result.checklist[0].title).to.equal('Oel & Filter')
  })

  it('should decode standard entities back to plain text', function () {
    const result = parseChecklist([{ title: 'Druck < 5 bar & Temp > 20' }])
    expect(result.ok).to.be.true
    expect(result.checklist[0].title).to.equal('Druck < 5 bar & Temp > 20')
  })

  it('should not double-decode encoded entities', function () {
    const result = parseChecklist([{ title: '&amp;lt;script&amp;gt;' }])
    expect(result.ok).to.be.true
    expect(result.checklist[0].title).to.equal('&lt;script&gt;')
  })

  it('should drop items without a usable title', function () {
    const result = parseChecklist([{ title: '   ' }, null, 'string', { title: 42 }, { title: 'ok' }])
    expect(result.ok).to.be.true
    expect(result.checklist).to.have.length(1)
    expect(result.checklist[0].title).to.equal('ok')
  })

  it('should reject more than 100 items', function () {
    const items = []
    for (let i = 0; i < 101; i++) items.push({ title: 'Item ' + i })
    const result = parseChecklist(items)
    expect(result.ok).to.be.false
    expect(result.error).to.contain('maximum of 100 items')
  })

  it('should accept exactly 100 items', function () {
    const items = []
    for (let i = 0; i < 100; i++) items.push({ title: 'Item ' + i })
    const result = parseChecklist(items)
    expect(result.ok).to.be.true
    expect(result.checklist).to.have.length(100)
  })

  it('should reject a title longer than 500 characters', function () {
    const result = parseChecklist([{ title: 'a'.repeat(501) }])
    expect(result.ok).to.be.false
    expect(result.error).to.contain('exceeds 500 characters')
  })

  it('should accept a title of exactly 500 characters', function () {
    const result = parseChecklist([{ title: 'a'.repeat(500) }])
    expect(result.ok).to.be.true
    expect(result.checklist[0].title).to.have.length(500)
  })

  describe('parseChecklistField', function () {
    it('should pass through undefined as "field untouched"', function () {
      const result = parseChecklistField(undefined)
      expect(result.ok).to.be.true
      expect(result.checklist).to.be.undefined
    })

    it('should reject non-array values', function () {
      const result = parseChecklistField('garbage')
      expect(result.ok).to.be.false
    })

    it('should parse an array value', function () {
      const result = parseChecklistField([{ title: '  Test  ' }])
      expect(result.ok).to.be.true
      expect(result.checklist).to.have.length(1)
      expect(result.checklist[0].title).to.equal('Test')
    })
  })
})

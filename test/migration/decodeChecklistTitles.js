/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const mongoose = require('mongoose')

const migrations = require('../../src/migration')
const SettingsSchema = require('../../src/models/setting')
const ticketTemplateSchema = require('../../src/models/ticketTemplate')
const recurringTaskSchema = require('../../src/models/recurringTask')
const ticketSchema = require('../../src/models/ticket')

const FLAG = 'migration:decodeChecklistTitles:done'

// Until PR #106 the checklistParser stored checklist titles entity-encoded
// (sanitize-html default). This run-once migration decodes the standard
// entities in tickettemplates / recurringtasks / tickets. Decoding is not
// idempotent, so the migration must run exactly once (settings flag).
describe('src/migration — decodeChecklistTitles (run-once)', function () {
  let templateId
  let recurringId
  let ticketId

  before(async function () {
    // Raw collection inserts: the migration operates on the collections
    // directly, and raw inserts let us skip unrelated required refs.
    templateId = new mongoose.Types.ObjectId()
    await ticketTemplateSchema.collection.insertOne({
      _id: templateId,
      name: 'decode-mig-template',
      checklist: [
        { _id: new mongoose.Types.ObjectId(), title: 'Oel &amp; Filter' },
        { _id: new mongoose.Types.ObjectId(), title: 'Druck &lt; 5 bar &gt; 1 bar' },
        { _id: new mongoose.Types.ObjectId(), title: 'Schon sauber' }
      ]
    })

    recurringId = new mongoose.Types.ObjectId()
    await recurringTaskSchema.collection.insertOne({
      _id: recurringId,
      name: 'decode-mig-recurring',
      checklist: [{ _id: new mongoose.Types.ObjectId(), title: '&quot;Anschlag&quot; pruefen &#39;ok&#39;' }]
    })

    ticketId = new mongoose.Types.ObjectId()
    await ticketSchema.collection.insertOne({
      _id: ticketId,
      uid: 999901,
      subject: 'decode-mig-ticket',
      checklist: [
        { _id: new mongoose.Types.ObjectId(), title: 'A &amp; B', completed: true },
        { _id: new mongoose.Types.ObjectId(), title: 'Plain title', completed: false }
      ]
    })
  })

  after(async function () {
    await ticketTemplateSchema.collection.deleteOne({ _id: templateId })
    await recurringTaskSchema.collection.deleteOne({ _id: recurringId })
    await ticketSchema.collection.deleteOne({ _id: ticketId })
    await SettingsSchema.collection.deleteOne({ name: FLAG })
  })

  it('should decode escaped titles in all three collections and set the done flag', async function () {
    await migrations.decodeChecklistTitles()

    const template = await ticketTemplateSchema.collection.findOne({ _id: templateId })
    expect(template.checklist.map(i => i.title)).to.deep.equal([
      'Oel & Filter',
      'Druck < 5 bar > 1 bar',
      'Schon sauber'
    ])

    const recurring = await recurringTaskSchema.collection.findOne({ _id: recurringId })
    expect(recurring.checklist[0].title).to.equal('"Anschlag" pruefen \'ok\'')

    const ticket = await ticketSchema.collection.findOne({ _id: ticketId })
    expect(ticket.checklist.map(i => i.title)).to.deep.equal(['A & B', 'Plain title'])
    // Sibling fields on ticket checklist items must survive the rewrite.
    expect(ticket.checklist[0].completed).to.be.true
    expect(ticket.checklist[1].completed).to.be.false

    const flag = await SettingsSchema.getSettingByName(FLAG)
    expect(flag).to.exist
    expect(flag.value).to.be.true
  })

  it('should not run again once the flag is set (no double-decode)', async function () {
    // A user may legitimately type "&amp;" into a title after the migration
    // ran. A second pass must leave it alone.
    await ticketTemplateSchema.collection.updateOne(
      { _id: templateId },
      { $set: { 'checklist.0.title': 'Literal &amp; intentional' } }
    )

    await migrations.decodeChecklistTitles()

    const template = await ticketTemplateSchema.collection.findOne({ _id: templateId })
    expect(template.checklist[0].title).to.equal('Literal &amp; intentional')
  })

  it('should decode &amp; last so encoded entities lose exactly one layer', async function () {
    await SettingsSchema.collection.deleteOne({ name: FLAG })
    await ticketTemplateSchema.collection.updateOne(
      { _id: templateId },
      { $set: { 'checklist.0.title': '&amp;lt;script&amp;gt;' } }
    )

    await migrations.decodeChecklistTitles()

    const template = await ticketTemplateSchema.collection.findOne({ _id: templateId })
    expect(template.checklist[0].title).to.equal('&lt;script&gt;')
  })
})

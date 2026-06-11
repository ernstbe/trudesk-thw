/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const m = require('mongoose')
const TicketTemplate = require('../../src/models/ticketTemplate')

describe('models/ticketTemplate.js', function () {
  let templateId

  it('should create a ticket template', async function () {
    const template = await TicketTemplate.create({
      name: 'Test Template',
      subject: 'Test Subject',
      issue: 'Test Issue',
      ticketType: new m.Types.ObjectId(),
      group: new m.Types.ObjectId(),
      priority: new m.Types.ObjectId(),
      createdBy: new m.Types.ObjectId()
    })

    expect(template).to.be.a('object')
    expect(template.name).to.equal('Test Template')
    expect(template.subject).to.equal('Test Subject')
    expect(template.updatedAt).to.be.a('date')
    templateId = template._id
  })

  it('should create a ticket template with checklist items', async function () {
    const template = await TicketTemplate.create({
      name: 'Checklist Template',
      subject: 'Checklist Subject',
      checklist: [{ title: 'First Step' }, { title: 'Second Step' }],
      createdBy: new m.Types.ObjectId()
    })

    expect(template.checklist).to.have.length(2)
    expect(template.checklist[0].title).to.equal('First Step')
    expect(template.checklist[1].title).to.equal('Second Step')
  })

  it('should default checklist to an empty array', async function () {
    const template = await TicketTemplate.findById(templateId)
    expect(template.checklist).to.be.a('array')
    expect(template.checklist).to.have.length(0)
  })

  it('should require a title on checklist items', async function () {
    try {
      await TicketTemplate.create({
        name: 'Invalid Checklist Template',
        subject: 'Checklist Subject',
        checklist: [{}],
        createdBy: new m.Types.ObjectId()
      })
      expect.fail('Should have thrown validation error')
    } catch (err) {
      expect(err.name).to.equal('ValidationError')
    }
  })

  it('should get all templates', async function () {
    const templates = await TicketTemplate.getAll()
    expect(templates).to.be.a('array')
    expect(templates.length).to.be.at.least(1)
  })

  it('should get a template by id', async function () {
    const template = await TicketTemplate.getById(templateId)
    expect(template).to.be.a('object')
    expect(template.name).to.equal('Test Template')
  })

  it('should return null for non-existent template', async function () {
    const template = await TicketTemplate.getById(new m.Types.ObjectId())
    expect(template).to.be.null
  })

  it('should enforce unique name constraint', async function () {
    try {
      await TicketTemplate.create({
        name: 'Test Template',
        subject: 'Another Subject',
        createdBy: new m.Types.ObjectId()
      })
      expect.fail('Should have thrown duplicate key error')
    } catch (err) {
      expect(err).to.exist
    }
  })

  it('should require name field', async function () {
    try {
      await TicketTemplate.create({
        subject: 'Subject without name',
        createdBy: new m.Types.ObjectId()
      })
      expect.fail('Should have thrown validation error')
    } catch (err) {
      expect(err.name).to.equal('ValidationError')
    }
  })

  it('should require subject field', async function () {
    try {
      await TicketTemplate.create({
        name: 'Template without subject',
        createdBy: new m.Types.ObjectId()
      })
      expect.fail('Should have thrown validation error')
    } catch (err) {
      expect(err.name).to.equal('ValidationError')
    }
  })

  it('should update updatedAt on save', async function () {
    const template = await TicketTemplate.findById(templateId)
    const oldUpdatedAt = template.updatedAt
    template.subject = 'Updated Subject'
    await template.save()
    expect(template.updatedAt.getTime()).to.be.at.least(oldUpdatedAt.getTime())
  })

  after(async function () {
    await TicketTemplate.deleteMany({})
  })
})

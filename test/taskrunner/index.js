/* eslint-disable no-unused-expressions */
const expect = require('chai').expect
const taskRunner = require('../../src/taskrunner')
const recurringTaskSchema = require('../../src/models/recurringTask')

describe('taskrunner/index.js', function () {
  let type, group, priority, user

  before(async function () {
    const tickettype = require('../../src/models/tickettype')
    const groupSchema = require('../../src/models/group')
    const prioritySchema = require('../../src/models/ticketpriority')
    const userSchema = require('../../src/models/user')

    type = await tickettype.getTypeByName('Task')
    group = await groupSchema.getGroupByName('TEST')
    priority = await prioritySchema.findOne({ default: true })
    user = await userSchema.getUserByUsername('trudesk')
  })

  it('should carry the checklist onto the generated ticket', async function () {
    const task = await recurringTaskSchema.create({
      name: 'Taskrunner Checklisten-Wartung',
      ticketSubject: 'Wartung mit Checkliste',
      ticketIssue: 'Bitte Checkliste abarbeiten',
      ticketType: type._id,
      ticketGroup: group._id,
      ticketPriority: priority._id,
      scheduleType: 'monthly',
      checklist: [{ title: 'Filter pruefen' }, { title: 'Oelstand kontrollieren' }],
      createdBy: user._id
    })

    const ticket = await taskRunner.createTicketFromRecurringTask(task)

    expect(ticket).to.be.a('object')
    expect(ticket.checklist).to.be.a('array')
    expect(ticket.checklist).to.have.length(2)
    expect(ticket.checklist[0].title).to.equal('Filter pruefen')
    expect(ticket.checklist[0].completed).to.be.false
    expect(ticket.checklist[1].title).to.equal('Oelstand kontrollieren')
    expect(ticket.checklist[1].completed).to.be.false
  })

  it('should generate a ticket without a checklist when the task has none', async function () {
    const task = await recurringTaskSchema.create({
      name: 'Taskrunner Wartung ohne Checkliste',
      ticketSubject: 'Wartung ohne Checkliste',
      ticketIssue: 'Keine Checkliste notwendig',
      ticketType: type._id,
      ticketGroup: group._id,
      ticketPriority: priority._id,
      scheduleType: 'monthly',
      createdBy: user._id
    })

    const ticket = await taskRunner.createTicketFromRecurringTask(task)

    expect(ticket).to.be.a('object')
    expect(ticket.checklist).to.have.length(0)
  })
})

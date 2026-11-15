/*
      .                              .o8                     oooo
   .o8                             "888                     `888
 .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
   888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
   888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
   888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
   "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 ========================================================================
*/

const cron = require('node-cron')
const winston = require('../logger')
const TicketSchema = require('../models/ticket')
const userSchema = require('../models/user')
const RecurringTask = require('../models/recurringTask')
const StatusSchema = require('../models/ticketStatus')
const sanitizeHtml = require('sanitize-html')

const taskRunner = {}

taskRunner.init = function (callback) {
  // Run recurring tasks check every 5 minutes
  cron.schedule('*/5 * * * *', function () {
    taskRunner.processRecurringTasks()
  })

  winston.debug('TaskRunner: Recurring tasks cron scheduled (every 5 minutes)')

  // Sliding-expiry housekeeping: drop access-token entries idle longer than
  // the configured TTL. Auth already rejects them lazily, but the array
  // would keep growing without a sweep. Sunday 03:15 to avoid the top-of-
  // the-hour cron storm.
  cron.schedule('15 3 * * 0', function () {
    taskRunner.purgeExpiredAccessTokens()
  })

  winston.debug('TaskRunner: Access-token purge cron scheduled (Sun 03:15)')

  return callback()
}

taskRunner.purgeExpiredAccessTokens = async function () {
  try {
    const result = await userSchema.purgeExpiredAccessTokens()
    if (result.tokensRemoved > 0) {
      winston.info('TaskRunner: Purged ' + result.tokensRemoved + ' expired access tokens from ' + result.usersTouched + ' users')
    }
    return result
  } catch (err) {
    winston.warn('TaskRunner: Failed to purge expired access tokens — ' + err.message)
  }
}

taskRunner.processRecurringTasks = async function () {
  try {
    const tasks = await RecurringTask.getEnabled()
    const now = new Date()

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]

      if (!task.nextRun || task.nextRun > now) continue

      try {
        await taskRunner.createTicketFromRecurringTask(task)

        task.lastRun = now
        task.nextRun = RecurringTask.calculateNextRun(task)
        await task.save()

        winston.info('TaskRunner: Created ticket from recurring task "' + task.name + '", next run: ' + task.nextRun)
      } catch (err) {
        winston.warn('TaskRunner: Failed to process recurring task "' + task.name + '" — ' + err.message)
      }
    }
  } catch (err) {
    winston.warn('TaskRunner: Error fetching recurring tasks — ' + err.message)
  }
}

taskRunner.createTicketFromRecurringTask = async function (task) {
  const defaultStatus = await StatusSchema.findOne({ isResolved: false }).sort({ order: 1 })
  if (!defaultStatus) throw new Error('No open status found')

  const historyItem = {
    action: 'ticket:created',
    description: 'Ticket automatically created from recurring task: ' + task.name,
    owner: task.createdBy
  }

  const ticketData = {
    owner: task.createdBy,
    group: task.ticketGroup,
    type: task.ticketType,
    status: defaultStatus._id,
    priority: task.ticketPriority,
    subject: sanitizeHtml(task.ticketSubject).trim(),
    issue: sanitizeHtml(task.ticketIssue).trim(),
    tags: task.ticketTags || [],
    history: [historyItem],
    subscribers: [task.createdBy]
  }

  if (task.ticketAssignee) {
    ticketData.assignee = task.ticketAssignee
  }

  if (task.checklist && task.checklist.length > 0) {
    ticketData.checklist = task.checklist.map(function (item) {
      return { title: item.title, completed: false }
    })
  }

  const ticket = new TicketSchema(ticketData)
  if (task.ticketAssignee) {
    ticket.addSubscriber(task.ticketAssignee)
  }

  const saved = await ticket.save()
  await saved.populate('group owner priority')

  const emitter = require('../emitter')
  emitter.emit('ticket:created', { ticket: saved })

  if (task.ticketAssignee) {
    const notifyAssignee = require('../helpers/notifyAssignee')
    await notifyAssignee(task.ticketAssignee, task.createdBy, saved)
  }

  return saved
}

module.exports = taskRunner

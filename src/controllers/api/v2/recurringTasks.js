const RecurringTask = require('../../../models/recurringTask')
const apiUtil = require('../apiUtils')
const { parseChecklistField } = require('./checklistParser')

const REQUIRED_REF_FIELDS = ['ticketType', 'ticketGroup', 'ticketPriority']
const SCHEDULE_FIELDS = ['scheduleType', 'dayOfMonth', 'monthsOfYear', 'daysBeforeDeadline']

const recurringTasksApi = {}

recurringTasksApi.get = async function (req, res) {
  try {
    const tasks = await RecurringTask.getAll()
    return apiUtil.sendApiSuccess(res, { recurringTasks: tasks })
  } catch (err) {
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

recurringTasksApi.single = async function (req, res) {
  const id = req.params.id
  if (!id) return apiUtil.sendApiError(res, 400, 'Invalid Parameters')

  try {
    const task = await RecurringTask.getById(id)
    if (!task) return apiUtil.sendApiError(res, 404, 'Recurring task not found')
    return apiUtil.sendApiSuccess(res, { recurringTask: task })
  } catch (err) {
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

recurringTasksApi.create = async function (req, res) {
  const postData = req.body
  if (!postData) return apiUtil.sendApiError_InvalidPostData(res)

  for (let i = 0; i < REQUIRED_REF_FIELDS.length; i++) {
    const field = REQUIRED_REF_FIELDS[i]
    if (!postData[field]) {
      return apiUtil.sendApiError(res, 400, 'Invalid Parameters: ' + field + ' is required')
    }
  }

  const checklistResult = parseChecklistField(postData.checklist)
  if (!checklistResult.ok) return apiUtil.sendApiError(res, 400, checklistResult.error)

  try {
    let task = await RecurringTask.create({
      name: postData.name,
      description: postData.description,
      ticketSubject: postData.ticketSubject,
      ticketIssue: postData.ticketIssue,
      ticketType: postData.ticketType,
      ticketGroup: postData.ticketGroup,
      ticketPriority: postData.ticketPriority,
      ticketAssignee: postData.ticketAssignee,
      ticketTags: postData.ticketTags,
      checklist: checklistResult.checklist,
      scheduleType: postData.scheduleType,
      dayOfMonth: postData.dayOfMonth,
      monthsOfYear: postData.monthsOfYear,
      daysBeforeDeadline: postData.daysBeforeDeadline,
      enabled: postData.enabled !== false,
      createdBy: req.user._id
    })

    task = await RecurringTask.getById(task._id)
    return apiUtil.sendApiSuccess(res, { recurringTask: task })
  } catch (err) {
    if (err.name === 'ValidationError') return apiUtil.sendApiError(res, 400, err.message)
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

recurringTasksApi.update = async function (req, res) {
  const id = req.params.id
  const postData = req.body
  if (!id || !postData) return apiUtil.sendApiError(res, 400, 'Invalid Parameters')

  const checklistResult = parseChecklistField(postData.checklist)
  if (!checklistResult.ok) return apiUtil.sendApiError(res, 400, checklistResult.error)

  try {
    let task = await RecurringTask.findById(id)
    if (!task) return apiUtil.sendApiError(res, 404, 'Recurring task not found')

    const allowedFields = [
      'name', 'description', 'ticketSubject', 'ticketIssue', 'ticketType',
      'ticketGroup', 'ticketPriority', 'ticketAssignee', 'ticketTags',
      'scheduleType', 'dayOfMonth', 'monthsOfYear', 'daysBeforeDeadline', 'enabled'
    ]

    for (let i = 0; i < allowedFields.length; i++) {
      const field = allowedFields[i]
      if (postData[field] === undefined) continue
      // Required refs cannot be unset - treat an explicit null as "leave unchanged"
      if (postData[field] === null && REQUIRED_REF_FIELDS.indexOf(field) !== -1) continue
      task[field] = postData[field]
    }

    if (checklistResult.checklist !== undefined) {
      task.checklist = checklistResult.checklist
    }

    // Recalculate next run only when the schedule actually changed, otherwise a
    // due task (nextRun in the past) would lose its pending run on unrelated edits
    const scheduleChanged = SCHEDULE_FIELDS.some(f => task.isModified(f))
    if (scheduleChanged) {
      task.nextRun = RecurringTask.calculateNextRun(task)
    }

    await task.save()
    task = await RecurringTask.getById(task._id)
    return apiUtil.sendApiSuccess(res, { recurringTask: task })
  } catch (err) {
    if (err.name === 'ValidationError') return apiUtil.sendApiError(res, 400, err.message)
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

recurringTasksApi.delete = async function (req, res) {
  const id = req.params.id
  if (!id) return apiUtil.sendApiError(res, 400, 'Invalid Parameters')

  try {
    const task = await RecurringTask.findById(id)
    if (!task) return apiUtil.sendApiError(res, 404, 'Recurring task not found')

    await RecurringTask.deleteOne({ _id: id })
    return apiUtil.sendApiSuccess(res)
  } catch (err) {
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

module.exports = recurringTasksApi

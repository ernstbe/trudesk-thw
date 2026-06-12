const TicketTemplate = require('../../../models/ticketTemplate')
const apiUtil = require('../apiUtils')
const { parseChecklistField } = require('./checklistParser')

const ticketTemplatesApi = {}

ticketTemplatesApi.get = async function (req, res) {
  try {
    const templates = await TicketTemplate.getAll()
    return apiUtil.sendApiSuccess(res, { ticketTemplates: templates })
  } catch (err) {
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

ticketTemplatesApi.single = async function (req, res) {
  const id = req.params.id
  if (!id) return apiUtil.sendApiError(res, 400, 'Invalid Parameters')

  try {
    const template = await TicketTemplate.getById(id)
    if (!template) return apiUtil.sendApiError(res, 404, 'Ticket template not found')
    return apiUtil.sendApiSuccess(res, { ticketTemplate: template })
  } catch (err) {
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

ticketTemplatesApi.create = async function (req, res) {
  const postData = req.body
  if (!postData) return apiUtil.sendApiError_InvalidPostData(res)

  const checklistResult = parseChecklistField(postData.checklist)
  if (!checklistResult.ok) return apiUtil.sendApiError(res, 400, checklistResult.error)

  try {
    let template = await TicketTemplate.create({
      name: postData.name,
      subject: postData.subject,
      issue: postData.issue,
      ticketType: postData.ticketType,
      group: postData.group,
      priority: postData.priority,
      tags: postData.tags,
      checklist: checklistResult.checklist,
      createdBy: req.user._id
    })

    template = await TicketTemplate.getById(template._id)
    return apiUtil.sendApiSuccess(res, { ticketTemplate: template })
  } catch (err) {
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

ticketTemplatesApi.update = async function (req, res) {
  const id = req.params.id
  const postData = req.body
  if (!id || !postData) return apiUtil.sendApiError(res, 400, 'Invalid Parameters')

  const checklistResult = parseChecklistField(postData.checklist)
  if (!checklistResult.ok) return apiUtil.sendApiError(res, 400, checklistResult.error)

  try {
    let template = await TicketTemplate.findById(id)
    if (!template) return apiUtil.sendApiError(res, 404, 'Ticket template not found')

    const allowedFields = ['name', 'subject', 'issue', 'ticketType', 'group', 'priority', 'tags']

    for (let i = 0; i < allowedFields.length; i++) {
      const field = allowedFields[i]
      if (postData[field] !== undefined) {
        template[field] = postData[field]
      }
    }

    if (checklistResult.checklist !== undefined) {
      template.checklist = checklistResult.checklist
    }

    await template.save()
    template = await TicketTemplate.getById(template._id)
    return apiUtil.sendApiSuccess(res, { ticketTemplate: template })
  } catch (err) {
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

ticketTemplatesApi.delete = async function (req, res) {
  const id = req.params.id
  if (!id) return apiUtil.sendApiError(res, 400, 'Invalid Parameters')

  try {
    const template = await TicketTemplate.findById(id)
    if (!template) return apiUtil.sendApiError(res, 404, 'Ticket template not found')

    await TicketTemplate.deleteOne({ _id: id })
    return apiUtil.sendApiSuccess(res)
  } catch (err) {
    return apiUtil.sendApiError(res, 500, err.message)
  }
}

module.exports = ticketTemplatesApi

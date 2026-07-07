/*
 *       .                             .o8                     oooo
 *    .o8                             "888                     `888
 *  .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
 *    888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
 *    888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
 *    888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
 *    "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 *  ========================================================================
 *  Author:     Chris Brame
 *  Updated:    1/20/19 4:43 PM
 *  Copyright (c) 2014-2019. All rights reserved.
 */

const ticketSchema = require('../../../models/ticket')
const groupSchema = require('../../../models/group')
const csv = require('csv')
const dayjs = require('../../../helpers/dayjs')

const apiReports = {
  generate: {}
}

// Resolve the group set for a report. When the client passes the sentinel
// 'all', expand it to every group the caller may report on (admins/agents →
// all groups, everyone else → their own); otherwise use the explicit list.
// The group models are async statics — the previous code fed them node
// callbacks that Mongoose 8 drops, so 'all' reports silently hung.
async function resolveReportGroups (req, postData) {
  if (!postData.groups || !postData.groups.includes('all')) return postData.groups
  if (req.user.role.isAdmin || req.user.role.isAgent) {
    return groupSchema.getAllGroupsNoPopulate()
  }
  return groupSchema.getAllGroupsOfUser(req.user._id)
}

/**
 * @api {post} /api/v1/reports/generate/tickets_by_group Generate Report - Groups
 * @apiName generate_ticketsByGroup
 * @apiDescription Generate report for the given groups
 * @apiVersion 0.1.9
 * @apiGroup Reports
 * @apiHeader {string} accesstoken The access token for the logged in user
 *
 * @apiParamExample {json} Request-Example:
 * {
 *      "startDate": {Date},
 *      "endDate": {Date},
 *      "groups": [{group_id}]
 * }
 *
 * @apiExample Example usage:
 * curl -X POST
 *      -H "accesstoken: {accesstoken}"
 *      -H "Content-Type: application/json"
 *      -l http://localhost/api/v1/reports/generate/tickets_by_group
 *
 * @apiSuccess {object} success Report was generate
 *
 * @apiError InvalidPostData The data was invalid
 * @apiErrorExample
 *      HTTP/1.1 400 Bad Request
 {
     "error": "Invalid Post Data"
 }
 */
apiReports.generate.ticketsByGroup = async function (req, res) {
  const postData = req.body
  if (!postData || !postData.startDate || !postData.endDate) { return res.status(400).json({ success: false, error: 'Invalid Post Data' }) }

  try {
    const tickets = await ticketSchema.getTicketsWithObject(postData.groups, {
      limit: -1,
      page: 0,
      filter: {
        date: {
          start: postData.startDate,
          end: postData.endDate
        }
      }
    })

    const input = processReportData(tickets)
    return processResponse(res, input)
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || err })
  }
}

apiReports.generate.ticketsByTeam = async function (req, res) {
  const postData = req.body
  if (!postData || !postData.startDate || !postData.endDate) { return res.status(400).json({ success: false, error: 'Invalid Post Data' }) }

  const departmentSchema = require('../../../models/department')
  try {
    const departments = await departmentSchema.getDepartmentsByTeam(postData.teams)

    const tickets = await ticketSchema.getTicketsByDepartments(departments, {
      limit: -1,
      page: 0,
      filter: {
        date: {
          start: postData.startDate,
          end: postData.endDate
        }
      }
    })

    const input = processReportData(tickets)
    return processResponse(res, input)
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}

/**
 * @api {post} /api/v1/reports/generate/tickets_by_priority Generate Report - Priority
 * @apiName generate_ticketsByPriority
 * @apiDescription Generate report for the given priorities
 * @apiVersion 0.1.9
 * @apiGroup Reports
 * @apiHeader {string} accesstoken The access token for the logged in user
 *
 * @apiParamExample {json} Request-Example:
 * {
 *      "startDate": {Date},
 *      "endDate": {Date},
 *      "groups": [{group_id}],
 *      "priorities": [{priority}]
 * }
 *
 * @apiExample Example usage:
 * curl -X POST
 *      -H "accesstoken: {accesstoken}"
 *      -H "Content-Type: application/json"
 *      -l http://localhost/api/v1/reports/generate/tickets_by_priority
 *
 * @apiSuccess {object} success Report was generate
 *
 * @apiError InvalidPostData The data was invalid
 * @apiErrorExample
 *      HTTP/1.1 400 Bad Request
 {
     "error": "Invalid Post Data"
 }
 */
apiReports.generate.ticketsByPriority = async function (req, res) {
  const postData = req.body

  try {
    const grps = await resolveReportGroups(req, postData)
    const tickets = await ticketSchema.getTicketsWithObject(grps, {
      limit: -1,
      page: 0,
      filter: {
        priority: postData.priorities
      }
    })

    const input = processReportData(tickets)
    return processResponse(res, input)
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || err })
  }
}

/**
 * @api {post} /api/v1/reports/generate/tickets_by_status Generate Report - Status
 * @apiName generate_ticketsByStatus
 * @apiDescription Generate report for the given status
 * @apiVersion 0.1.9
 * @apiGroup Reports
 * @apiHeader {string} accesstoken The access token for the logged in user
 *
 * @apiParamExample {json} Request-Example:
 * {
 *      "startDate": {Date},
 *      "endDate": {Date},
 *      "groups": [{group_id}],
 *      "status": [{status}]
 * }
 *
 * @apiExample Example usage:
 * curl -X POST
 *      -H "accesstoken: {accesstoken}"
 *      -H "Content-Type: application/json"
 *      -l http://localhost/api/v1/reports/generate/tickets_by_status
 *
 * @apiSuccess {object} success Report was generate
 *
 * @apiError InvalidPostData The data was invalid
 * @apiErrorExample
 *      HTTP/1.1 400 Bad Request
 {
     "error": "Invalid Post Data"
 }
 */
apiReports.generate.ticketsByStatus = async function (req, res) {
  const postData = req.body

  try {
    const grps = await resolveReportGroups(req, postData)
    const tickets = await ticketSchema.getTicketsWithObject(grps, {
      limit: -1,
      page: 0,
      status: postData.status,
      filter: {
        date: {
          start: postData.startDate,
          end: postData.endDate
        }
      }
    })

    const input = processReportData(tickets)
    return processResponse(res, input)
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || err })
  }
}

/**
 * @api {post} /api/v1/reports/generate/tickets_by_tags Generate Report - Tags
 * @apiName generate_ticketsByTags
 * @apiDescription Generate report for the given tags
 * @apiVersion 0.1.9
 * @apiGroup Reports
 * @apiHeader {string} accesstoken The access token for the logged in user
 *
 * @apiParamExample {json} Request-Example:
 * {
 *      "startDate": {Date},
 *      "endDate": {Date},
 *      "groups": [{group_id}],
 *      "tags": [{tag_id}]
 * }
 *
 * @apiExample Example usage:
 * curl -X POST
 *      -H "accesstoken: {accesstoken}"
 *      -H "Content-Type: application/json"
 *      -l http://localhost/api/v1/reports/generate/tickets_by_tags
 *
 * @apiSuccess {object} success Report was generate
 *
 * @apiError InvalidPostData The data was invalid
 * @apiErrorExample
 *      HTTP/1.1 400 Bad Request
 {
     "error": "Invalid Post Data"
 }
 */
apiReports.generate.ticketsByTags = async function (req, res) {
  const postData = req.body

  try {
    const grps = await resolveReportGroups(req, postData)
    const tickets = await ticketSchema.getTicketsWithObject(grps, {
      limit: -1,
      page: 0,
      filter: {
        date: {
          start: postData.startDate,
          end: postData.endDate
        },
        tags: postData.tags
      }
    })

    const input = processReportData(tickets)
    return processResponse(res, input)
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || err })
  }
}

/**
 * @api {post} /api/v1/reports/generate/tickets_by_type Generate Report - Type
 * @apiName generate_ticketsByType
 * @apiDescription Generate report for the given types
 * @apiVersion 0.1.9
 * @apiGroup Reports
 * @apiHeader {string} accesstoken The access token for the logged in user
 *
 * @apiParamExample {json} Request-Example:
 * {
 *      "startDate": {Date},
 *      "endDate": {Date},
 *      "groups": [{group_id}],
 *      "types": [{type_id}]
 * }
 *
 * @apiExample Example usage:
 * curl -X POST
 *      -H "accesstoken: {accesstoken}"
 *      -H "Content-Type: application/json"
 *      -l http://localhost/api/v1/reports/generate/tickets_by_type
 *
 * @apiSuccess {object} success Report was generate
 *
 * @apiError InvalidPostData The data was invalid
 * @apiErrorExample
 *      HTTP/1.1 400 Bad Request
 {
     "error": "Invalid Post Data"
 }
 */
apiReports.generate.ticketsByType = async function (req, res) {
  const postData = req.body

  try {
    const grps = await resolveReportGroups(req, postData)
    const tickets = await ticketSchema.getTicketsWithObject(grps, {
      limit: -1,
      page: 0,
      filter: {
        date: {
          start: postData.startDate,
          end: postData.endDate
        },
        types: postData.types
      }
    })

    const input = processReportData(tickets)
    return processResponse(res, input)
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || err })
  }
}

/**
 * @api {post} /api/v1/reports/generate/tickets_by_user Generate Report - User
 * @apiName generate_ticketsByUser
 * @apiDescription Generate report for the given users
 * @apiVersion 0.1.9
 * @apiGroup Reports
 * @apiHeader {string} accesstoken The access token for the logged in user
 *
 * @apiParamExample {json} Request-Example:
 * {
 *      "startDate": {Date},
 *      "endDate": {Date},
 *      "groups": [{group_id}],
 *      "users": [{user_id}]
 * }
 *
 * @apiExample Example usage:
 * curl -X POST
 *      -H "accesstoken: {accesstoken}"
 *      -H "Content-Type: application/json"
 *      -l http://localhost/api/v1/reports/generate/tickets_by_user
 *
 * @apiSuccess {object} success Report was generate
 *
 * @apiError InvalidPostData The data was invalid
 * @apiErrorExample
 *      HTTP/1.1 400 Bad Request
 {
     "error": "Invalid Post Data"
 }
 */
apiReports.generate.ticketsByUser = async function (req, res) {
  const postData = req.body

  try {
    const grps = await resolveReportGroups(req, postData)
    const tickets = await ticketSchema.getTicketsWithObject(grps, {
      limit: -1,
      page: 0,
      filter: {
        date: {
          start: postData.startDate,
          end: postData.endDate
        },
        owner: postData.users
      }
    })

    const input = processReportData(tickets)
    return processResponse(res, input)
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || err })
  }
}

apiReports.generate.ticketsByAssignee = async function (req, res) {
  const postData = req.body

  try {
    const grps = await resolveReportGroups(req, postData)
    const tickets = await ticketSchema.getTicketsWithObject(grps, {
      limit: -1,
      page: 0,
      filter: {
        date: {
          start: postData.startDate,
          end: postData.endDate
        },
        assignee: postData.assignee
      }
    })

    const input = processReportData(tickets)
    return processResponse(res, input)
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || err })
  }
}

function processReportData (tickets) {
  const input = []
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i]

    const t = []
    t.push(ticket.uid)
    t.push(ticket.type.name)
    t.push(ticket.priority.name)
    t.push(ticket.statusFormatted)
    t.push(dayjs(ticket.date).format('MMM DD, YY HH:mm:ss'))
    t.push(ticket.subject)
    t.push(ticket.owner.fullname)
    t.push(ticket.group.name)
    if (ticket.assignee) {
      t.push(ticket.assignee.fullname)
    } else {
      t.push('')
    }

    let tags = ''
    for (let k = 0; k < ticket.tags.length; k++) {
      if (k === ticket.tags.length - 1) {
        tags += ticket.tags[k].name
      } else {
        tags += ticket.tags[k].name + ';'
      }
    }

    t.push(tags)

    input.push(t)
  }

  return input
}

function processResponse (res, input) {
  const headers = {
    uid: 'uid',
    type: 'type',
    priority: 'priority',
    status: 'status',
    created: 'created',
    subject: 'subject',
    requester: 'requester',
    group: 'group',
    assignee: 'assignee',
    tags: 'tags'
  }

  csv.stringify(input, { header: true, columns: headers }, function (err, output) {
    if (err) return res.status(400).json({ success: false, error: err })

    res.setHeader('Content-disposition', 'attachment; filename=report_output.csv')
    res.set('Content-Type', 'text/csv')
    res.send(output)
  })
}

module.exports = apiReports

/*
 *       .                             .o8                     oooo
 *    .o8                             "888                     `888
 *  .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
 *    888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
 *    888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
 *    888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
 *    "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 *  ========================================================================
 */

const sanitizeHtml = require('sanitize-html')
const groupSchema = require('../../models/group')
const departmentSchema = require('../../models/department')

/**
 * Applies the editable fields of a PUT ticket payload onto a ticket document.
 *
 * Shared by v1 `apiTickets.update` and v2 `ticketsV2.update` so both API
 * versions persist the exact same whitelist of fields with the same history
 * semantics. Unknown / non-whitelisted fields in `reqTicket` are ignored.
 *
 * The function only mutates the document — it does NOT save. Callers are
 * responsible for `ticket.save()` (which also triggers the post-save hook
 * that emits `ticket:updated` for realtime clients).
 *
 * Throws `Error('Invalid dueDate')` for unparsable due dates and propagates
 * model errors (e.g. `Invalid Type Id`). Callers map those to a 400 response.
 * Moving the ticket into a group the user cannot see throws an error with
 * `statusCode = 403`, which callers map to a 403 response.
 *
 * @param {Object} ticket Mongoose ticket document to mutate
 * @param {Object} reqTicket Request payload with the fields to update
 * @param {Object} user Account performing this action (history owner; role
 *                      must be populated for the group access check)
 */
async function applyTicketUpdate (ticket, reqTicket, user) {
  const userId = user._id
  if (reqTicket.status !== undefined) {
    ticket.status = reqTicket.status
  }

  if (reqTicket.subject !== undefined) {
    ticket.subject = sanitizeHtml(reqTicket.subject).trim()
  }

  if (reqTicket.group !== undefined) {
    const requestedGroupId = (reqTicket.group._id || reqTicket.group).toString()
    const currentGroupId = ticket.group ? (ticket.group._id || ticket.group).toString() : null

    // Moving a ticket into another group is gated the same way ticket
    // create is (PR #97): the caller must be able to see the target group.
    // Admins/agents are matched against their team→department mapping,
    // everyone else against direct group membership. Without this, anyone
    // holding the generic tickets:update grant (the default user role has
    // it) could move tickets into arbitrary groups.
    if (requestedGroupId !== currentGroupId) {
      let allowedGroupIds
      if (user.role.isAdmin || user.role.isAgent) {
        const dbGroups = await departmentSchema.getDepartmentGroupsOfUser(userId)
        allowedGroupIds = dbGroups.map(g => g._id.toString())
      } else {
        const dbGroups = await groupSchema.getAllGroupsOfUser(userId)
        allowedGroupIds = dbGroups.map(g => g._id.toString())
      }

      if (!allowedGroupIds.includes(requestedGroupId)) {
        const err = new Error('Forbidden: group not accessible to this user')
        err.statusCode = 403
        throw err
      }
    }

    ticket.group = reqTicket.group._id || reqTicket.group
    await ticket.populate('group')
  }

  if (reqTicket.priority !== undefined) {
    ticket.priority = reqTicket.priority._id || reqTicket.priority
    await ticket.populate('priority')
  }

  // Type was silently dropped here previously — every PWA `Type` chip
  // change ended up as a no-op. Route it through the schema helper
  // so we get the existing 'ticket:set:type' history entry plus a
  // proper "type does not exist" error if the id is bad.
  if (reqTicket.type !== undefined) {
    const typeId = reqTicket.type._id || reqTicket.type
    await ticket.setTicketType(userId, typeId)
    await ticket.populate('type')
  }

  // Same silent-drop class as the type field above: due-date edits
  // from the PWA returned success while persisting nothing. `null`
  // clears the date; skip identical values so plain subject/issue
  // updates don't spam the history with duedate entries.
  if (reqTicket.dueDate !== undefined) {
    const newDueDate = reqTicket.dueDate === null ? null : new Date(reqTicket.dueDate)
    if (newDueDate !== null && isNaN(newDueDate.getTime())) {
      throw new Error('Invalid dueDate')
    }

    const currentTime = ticket.dueDate ? new Date(ticket.dueDate).getTime() : null
    const newTime = newDueDate === null ? null : newDueDate.getTime()
    if (currentTime !== newTime) {
      ticket.setTicketDueDate(userId, newDueDate)
    }
  }

  if (reqTicket.closedDate !== undefined) {
    ticket.closedDate = reqTicket.closedDate
  }

  if (reqTicket.tags !== undefined && reqTicket.tags !== null) {
    ticket.tags = reqTicket.tags
  }

  if (reqTicket.issue !== undefined && reqTicket.issue !== null) {
    ticket.issue = sanitizeHtml(reqTicket.issue).trim()
  }

  if (reqTicket.assignee !== undefined) {
    if (reqTicket.assignee === null) {
      // Explicit null clears the assignee (mirrors the dedicated v1 DELETE
      // /tickets/:id/assignee route, which the PWA does NOT call - it sends
      // `assignee: null` through this same generic update path in both v1
      // and v2 mode). This used to be silently ignored, so "unassign" was a
      // no-op that reported success. Only touch history if there actually
      // was an assignee, so a payload that just echoes back `assignee: null`
      // on an already-unassigned ticket doesn't spam the history.
      if (ticket.assignee) {
        ticket.clearAssignee(userId)
      }
    } else {
      const previousAssigneeId = ticket.assignee ? (ticket.assignee._id || ticket.assignee).toString() : null
      ticket.assignee = reqTicket.assignee._id || reqTicket.assignee
      await ticket.populate('assignee')

      const assigneeName = ticket.assignee && ticket.assignee.fullname
        ? ticket.assignee.fullname
        : 'Unknown'
      const HistoryItem = {
        action: 'ticket:set:assignee',
        description: assigneeName + ' was set as assignee',
        owner: userId
      }

      ticket.history.push(HistoryItem)

      // Notify the newly assigned user (skips self-assignment). Only on an
      // actual change so a plain re-save with the same assignee stays quiet.
      const newAssigneeId = ticket.assignee && ticket.assignee._id ? ticket.assignee._id.toString() : null
      if (newAssigneeId && newAssigneeId !== previousAssigneeId) {
        await require('../../helpers/notifyAssignee')(newAssigneeId, userId, ticket)
      }
    }
  }

  return ticket
}

module.exports = { applyTicketUpdate }

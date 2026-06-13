const winston = require('../logger')

/**
 * Best-effort in-app notification telling a user they were assigned a ticket.
 *
 * Saving a Notification also fires a web push via the model's post-save hook,
 * and the socket event loop pushes it to the recipient's session, so this is
 * the single thing the assignment paths need to call.
 *
 * Self-assignment is skipped (no point notifying yourself). Never throws into
 * the caller's request flow — assignment already succeeded by the time we run.
 *
 * @param {string|ObjectId} assigneeId Recipient (the newly assigned user)
 * @param {string|ObjectId} actingUserId User who performed the assignment
 * @param {Object} ticket Ticket document (needs uid and subject)
 */
async function notifyAssignee (assigneeId, actingUserId, ticket) {
  try {
    if (!assigneeId || !ticket) return
    const recipientId = assigneeId.toString()
    if (actingUserId && recipientId === actingUserId.toString()) return

    const Notification = require('../models/notification')
    const notification = new Notification({
      owner: assigneeId,
      title: 'Ticket #' + ticket.uid + ' dir zugewiesen',
      message: ticket.subject || '',
      type: 0,
      data: { ticket: { _id: ticket._id, uid: ticket.uid, subject: ticket.subject } },
      unread: true
    })
    await notification.save()
  } catch (err) {
    winston.warn('notifyAssignee failed: ' + (err && err.message ? err.message : err))
  }
}

module.exports = notifyAssignee

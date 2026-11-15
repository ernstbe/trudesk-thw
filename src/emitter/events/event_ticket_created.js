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
 *  Updated:    4/20/22 2:12 AM
 *  Copyright (c) 2014-2022. All rights reserved.
 */

const logger = require('../../logger')
const Ticket = require('../../models/ticket')
const User = require('../../models/user')
const Department = require('../../models/department')
const Notification = require('../../models/notification')

const permissions = require('../../permissions')

const socketUtils = require('../../helpers/utils')
const sharedVars = require('../../socketio/index').shared
const socketEvents = require('../../socketio/socketEventConsts')
const util = require('../../helpers/utils')
const { groupRoom } = require('../../socketio/ticketSocket')

const sendSocketUpdateToUser = (user, ticket) => {
  socketUtils.sendToUser(
    sharedVars.sockets,
    sharedVars.usersOnline,
    user.username,
    '$trudesk:client:ticket:created',
    ticket
  )
}

const getTeamMembers = async group => {
  const departments = await Department.getDepartmentsByGroup(group._id)
  if (!departments) throw new Error('Group is not assigned to any departments. Exiting...')
  return departments.map(department => {
    return department.teams.map(team => {
      return team.members.map(member => {
        return member
      })
    })
  }).flat(Infinity)
}

// Live-update every member's open ticket list. (E-mail for new tickets now
// goes through the Notification model like push; see src/mailer/notificationMail.js.)
const sendSocketUpdatesToMembers = async ticket => {
  const teamMembers = await getTeamMembers(ticket.group)

  const seenIds = new Set()
  for (const member of [...teamMembers, ...ticket.group.members]) {
    if (!member || member.deleted) continue
    const id = String(member._id)
    if (seenIds.has(id)) continue
    seenIds.add(id)
    sendSocketUpdateToUser(member, ticket)
  }
}

const createNotification = async ticket => {
  let members = await getTeamMembers(ticket.group)

  members = [...members, ...ticket.group.members]
  const seenIds = new Set()
  members = members.filter(i => {
    const id = String(i._id)
    if (seenIds.has(id)) return false
    seenIds.add(id)
    return true
  })

  for (const member of members) {
    if (!member) continue
    await saveNotification(member, ticket)
  }
}

const createPublicNotification = async ticket => {
  let rolesWithPublic = permissions.getRoles('ticket:public')
  rolesWithPublic = rolesWithPublic.map(r => r.id)
  const users = await User.getUsersByRoles(rolesWithPublic)

  for (const user of users) {
    await saveNotification(user, ticket)
  }
}

const saveNotification = async (user, ticket) => {
  const notification = new Notification({
    owner: user,
    title: `Ticket #${ticket.uid} Created`,
    message: ticket.subject,
    type: 0,
    data: { ticket },
    mailKind: 'newTicket',
    unread: true
  })

  await notification.save()
}

module.exports = async data => {
  const ticketObject = data.ticket
  // eslint-disable-next-line no-unused-vars
  const _hostname = data.hostname

  try {
    const ticket = await Ticket.getTicketById(ticketObject._id)

    await sendSocketUpdatesToMembers(ticket)

    if (ticket.group.public) await createPublicNotification(ticket)
    else await createNotification(ticket)

    // Same Jugend/Stab group-room scoping as ticketSocket.js — a global
    // broadcast here would notify every connected socket of a brand-new
    // ticket's subject/issue, including agents outside its group.
    if (ticket.group) {
      util.sendToAllClientsInRoom(io, groupRoom(ticket.group), socketEvents.TICKETS_CREATED, ticket)
    } else {
      util.sendToAllConnectedClients(io, socketEvents.TICKETS_CREATED, ticket)
    }
  } catch (e) {
    logger.warn(`[trudesk:events:ticket:created] - Error: ${e}`)
  }
}

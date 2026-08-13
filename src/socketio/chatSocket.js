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
const winston = require('../logger')
const utils = require('../helpers/utils')
const userSchema = require('../models/user')

const sharedVars = require('./index').shared
const sharedUtils = require('./index').utils
const socketEventConst = require('./socketEventConsts')

const events = {}

function register (socket) {
  events.onSetUserOnlineStatus(socket)
  events.onUpdateUsers(socket)
  events.updateOnlineBubbles(socket)
  events.updateConversationsNotifications(socket)
  events.spawnChatWindow(socket)
  events.getOpenChatWindows(socket)
  events.onChatMessage(socket)
  events.onChatTyping(socket)
  events.onChatStopTyping(socket)
  events.saveChatWindow(socket)
  events.onDisconnect(socket)

  if (socket.request.user.logged_in) {
    joinChatServer(socket)
  }
}

function eventLoop () {
  updateUsers()
  updateOnlineBubbles()
}

events.onUpdateUsers = function (socket) {
  socket.on('updateUsers', updateUsers)
}

events.onSetUserOnlineStatus = function (socket) {
  socket.on(socketEventConst.UI_ONLINE_STATUS_SET, data => {
    const state = data.state
    const user = socket.request.user
    let exists = false

    if (state === 'idle') {
      if (Object.prototype.hasOwnProperty.call(sharedVars.idleUsers, user.username.toLowerCase())) exists = true

      if (!exists) {
        if (user.username.length !== 0) {
          sharedVars.idleUsers[user.username.toLowerCase()] = {
            sockets: [socket.id],
            user
          }

          updateOnlineBubbles()
        }
      } else {
        const idleUser = sharedVars.idleUsers[user.username.toLowerCase()]
        if (idleUser !== undefined) {
          idleUser.sockets.push(socket.id)

          updateOnlineBubbles()
        }
      }
    } else if (state === 'active') {
      if (Object.prototype.hasOwnProperty.call(sharedVars.idleUsers, user.username.toLowerCase())) {
        delete sharedVars.idleUsers[user.username.toLowerCase()]

        updateOnlineBubbles()
      }
    }
  })
}

function updateUsers () {
  const sortedUserList = sharedUtils.sortByKeys(sharedVars.usersOnline)
  Object.values(sortedUserList).forEach(function (v) {
    const user = v.user
    const sockets = v.sockets
    if (user && sockets.length > 0) {
      sockets.forEach(function (sock) {
        const socket = sharedVars.sockets.find(function (s) {
          return s.id === sock
        })

        if (socket) {
          if (user.role.isAdmin || user.role.isAgent) {
            socket.emit('updateUsers', sortedUserList)
          } else {
            const groupSchema = require('../models/group')
            groupSchema.getAllGroupsOfUser(user._id, function (err, groups) {
              if (!err) {
                let usersOfGroups = groups.map(function (g) {
                  return g.members.map(function (m) {
                    return { user: m }
                  })
                })

                const agentsAndAdmins = Object.values(sortedUserList).filter(function (u) {
                  return u.user.role.isAdmin || u.user.role.isAgent
                })

                usersOfGroups = [].concat(usersOfGroups, agentsAndAdmins)

                let onlineUsernames = Object.values(sortedUserList).map(function (u) {
                  return u.user.username
                })
                onlineUsernames = onlineUsernames.flat(Infinity)

                const sortedUsernames = usersOfGroups.flat(Infinity).map(function (u) {
                  return u.user.username
                })

                const actual = onlineUsernames.filter(u => sortedUsernames.includes(u))

                const seenIds = new Set()
                usersOfGroups = usersOfGroups.flat(Infinity).filter(function (i) {
                  if (actual.indexOf(i.user.username) === -1) return false
                  const id = i.user._id.toString()
                  if (seenIds.has(id)) return false
                  seenIds.add(id)
                  return true
                })

                const sortedKeys = usersOfGroups.map(function (m) {
                  return m.user.username
                })

                const obj = Object.fromEntries(sortedKeys.map((k, idx) => [k, usersOfGroups[idx]]))

                socket.emit('updateUsers', obj)
              }
            })
          }
        }
      })
    }
  })
  // utils.sendToAllConnectedClients(io, 'updateUsers', sortedUserList)
}

function updateOnlineBubbles () {
  // Send arrays, not objects. The React Avatar component calls `.some(...)`
  // on these lists; objects don't have `.some` and threw a runtime TypeError
  // for every connected client every time someone went online/offline.
  // Legacy chat.js uses `_.each(list, fn)` which works on both arrays and
  // objects, so flipping to arrays is safe for both consumers.
  const sortedUserList = Object.entries(sharedVars.usersOnline)
    .sort(function (a, b) { return a[0].localeCompare(b[0]) })
    .map(function (entry) { return entry[1] })
  const sortedIdleList = Object.entries(sharedVars.idleUsers)
    .sort(function (a, b) { return a[0].localeCompare(b[0]) })
    .map(function (entry) { return entry[1] })

  utils.sendToAllConnectedClients(io, socketEventConst.UI_ONLINE_STATUS_UPDATE, {
    sortedUserList,
    sortedIdleList
  })
}

events.updateOnlineBubbles = function (socket) {
  socket.on(socketEventConst.UI_ONLINE_STATUS_UPDATE, function () {
    updateOnlineBubbles()
  })
}

async function updateConversationsNotifications (socket) {
  if (!socket || !socket.request || !socket.request.user) return

  const user = socket.request.user
  const Message = require('../models/chat/message')
  const Conversation = require('../models/chat/conversation')

  try {
    // getConversationsWithLimit / getMostRecentMessage are async statics; the
    // old node-callback form was dropped under Mongoose 8, so this handler
    // never sent an update and the conversation-notification list was dead.
    const conversations = await Conversation.getConversationsWithLimit(user._id, null)
    const convos = []

    for (const convo of conversations) {
      const c = convo.toObject()

      const userMeta = convo.userMeta[convo.userMeta.findIndex(i => i.userId.toString() === user._id.toString())]
      if (userMeta !== undefined && userMeta.deletedAt !== undefined && userMeta.deletedAt > convo.updatedAt) {
        continue
      }

      let rm = await Message.getMostRecentMessage(c._id)

      c.participants.forEach(p => {
        if (p._id.toString() !== user._id.toString()) {
          c.partner = p
        }
      })

      rm = rm[0]

      if (rm !== undefined) {
        if (!c.partner || !rm.owner) continue

        if (c.partner._id.toString() === rm.owner._id.toString()) {
          c.recentMessage = c.partner.fullname + ': ' + rm.body
        } else {
          c.recentMessage = 'You: ' + rm.body
        }
      } else {
        c.recentMessage = 'New Conversation'
      }

      convos.push(c)
    }

    return utils.sendToSelf(socket, socketEventConst.MESSAGES_UPDATE_UI_CONVERSATION_NOTIFICATIONS, {
      conversations: convos.length >= 10 ? convos.slice(0, 9) : convos
    })
  } catch (err) {
    winston.warn(err.message || err)
  }
}

events.updateConversationsNotifications = function (socket) {
  socket.on(socketEventConst.MESSAGES_UPDATE_UI_CONVERSATION_NOTIFICATIONS, function () {
    updateConversationsNotifications(socket)
  })
}

async function spawnOpenChatWindows (socket) {
  const loggedInAccountId = socket.request.user._id
  const userSchema = require('../models/user')
  const conversationSchema = require('../models/chat/conversation')

  try {
    // getUser / getConversation are async statics; their dropped callbacks
    // meant open chat windows were never re-spawned on reconnect.
    const user = await userSchema.getUser(loggedInAccountId)
    if (!user || !user.preferences || !user.preferences.openChatWindows) return

    for (const convoId of user.preferences.openChatWindows) {
      let partner = null
      const conversation = await conversationSchema.getConversation(convoId)
      if (!conversation) continue

      conversation.participants.forEach(function (i) {
        if (i._id.toString() !== loggedInAccountId.toString()) {
          partner = i.toObject()
        }
      })

      if (partner === null) continue

      delete partner.password
      delete partner.resetPassHash
      delete partner.resetPassExpire
      delete partner.accessToken
      delete partner.iOSDeviceTokens
      delete partner.deleted

      utils.sendToSelf(socket, 'spawnChatWindow', partner)
    }
  } catch (err) {
    winston.warn(err)
  }
}

events.getOpenChatWindows = function (socket) {
  socket.on('getOpenChatWindows', function () {
    spawnOpenChatWindows(socket)
  })
}

events.spawnChatWindow = function (socket) {
  socket.on(socketEventConst.MESSAGES_SPAWN_CHAT_WINDOW, async function ({ convoId }) {
    if (!socket.request.user || !convoId) return true

    const User = require('../models/user')
    try {
      const user = await User.getUser(socket.request.user._id)
      if (user !== null) {
        user.addOpenChatWindow(convoId)

        utils.sendToUser(
          sharedVars.sockets,
          sharedVars.usersOnline,
          user.username,
          socketEventConst.MESSAGES_UI_SPAWN_CHAT_WINDOW,
          user
        )
      }
    } catch (err) {
      winston.warn(err)
    }
  })
}

events.saveChatWindow = function (socket) {
  socket.on(socketEventConst.MESSAGES_SAVE_CHAT_WINDOW, async function (data) {
    const { userId, convoId, remove } = data

    const User = require('../models/user')
    try {
      const user = await User.getUser(userId)
      if (user !== null) {
        if (remove) {
          user.removeOpenChatWindow(convoId)
        } else {
          user.addOpenChatWindow(convoId)
        }

        utils.sendToUser(
          sharedVars.sockets,
          sharedVars.usersOnline,
          user.username,
          socketEventConst.MESSAGES_SAVE_CHAT_WINDOW_COMPLETE
        )
      }
    } catch (err) {
      winston.warn(err)
    }
  })
}

events.onChatMessage = function (socket) {
  socket.on(socketEventConst.MESSAGES_SEND, async function (data) {
    if (!data || !data.message || !data.message.owner || !data.message.owner._id) {
      return utils.sendToSelf(socket, socketEventConst.MESSAGES_UI_RECEIVE, { message: 'Invalid chat message payload' })
    }

    const to = data.to
    const from = data.from

    const User = require('../models/user')

    data.message.owner = {
      _id: data.message.owner._id,
      email: data.message.owner.email,
      username: data.message.owner.username,
      fullname: data.message.owner.fullname,
      image: data.message.owner.image,
      title: data.message.owner.title,
      lastOnline: data.message.owner.lastOnline,
      id: data.message.owner._id
    }

    try {
      // getUser is an async static — resolve both participants in parallel.
      const [toUser, fromUser] = await Promise.all([User.getUser(to), User.getUser(from)])
      if (!toUser) throw new Error('User Not Found!')
      if (!fromUser) throw new Error('User Not Found')

      // Strip
      data.toUser = {
        _id: toUser._id,
        email: toUser.email,
        username: toUser.username,
        fullname: toUser.fullname,
        image: toUser.image,
        title: toUser.title,
        lastOnline: toUser.lastOnline,
        id: toUser._id
      }

      data.fromUser = {
        _id: fromUser._id,
        email: fromUser.email,
        username: fromUser.username,
        fullname: fromUser.fullname,
        image: fromUser.image,
        title: fromUser.title,
        lastOnline: fromUser.lastOnline,
        id: fromUser._id
      }

      utils.sendToUser(
        sharedVars.sockets,
        sharedVars.usersOnline,
        data.toUser.username,
        socketEventConst.MESSAGES_UI_RECEIVE,
        data
      )

      utils.sendToUser(
        sharedVars.sockets,
        sharedVars.usersOnline,
        data.fromUser.username,
        socketEventConst.MESSAGES_UI_RECEIVE,
        data
      )
    } catch (err) {
      return utils.sendToSelf(socket, socketEventConst.MESSAGES_UI_RECEIVE, { message: err.message || err })
    }
  })
}

events.onChatTyping = function (socket) {
  socket.on(socketEventConst.MESSAGES_USER_TYPING, function (data) {
    if (!data) return

    const to = data.to
    const from = data.from

    let user = null
    let fromUser = null

    Object.values(sharedVars.usersOnline).forEach(function (v) {
      if (String(v.user._id) === String(to)) {
        user = v.user
      }

      if (String(v.user._id) === String(from)) {
        fromUser = v.user
      }
    })

    if (user === null || fromUser === null) {
      return
    }

    data.toUser = user
    data.fromUser = fromUser

    utils.sendToUser(
      sharedVars.sockets,
      sharedVars.usersOnline,
      user.username,
      socketEventConst.MESSAGES_UI_USER_TYPING,
      data
    )
  })
}

events.onChatStopTyping = function (socket) {
  socket.on(socketEventConst.MESSAGES_USER_STOP_TYPING, function (data) {
    if (!data) return

    const to = data.to
    let user = null

    Object.values(sharedVars.usersOnline).forEach(function (v) {
      if (String(v.user._id) === String(to)) {
        user = v.user
      }
    })

    if (user === null) {
      return
    }

    data.toUser = user

    utils.sendToUser(
      sharedVars.sockets,
      sharedVars.usersOnline,
      user.username,
      socketEventConst.MESSAGES_UI_USER_STOP_TYPING,
      data
    )
  })
}

function joinChatServer (socket) {
  const user = socket.request.user
  let exists = false
  if (Object.prototype.hasOwnProperty.call(sharedVars.usersOnline, user.username.toLowerCase())) {
    exists = true
  }

  if (!exists) {
    if (user.username.length !== 0) {
      sharedVars.usersOnline[user.username] = {
        sockets: [socket.id],
        user
      }
      // sortedUserList = sharedUtils.sortByKeys(sharedVars.usersOnline)

      utils.sendToSelf(socket, 'joinSuccessfully')
      // utils.sendToAllConnectedClients(io, 'updateUsers', sortedUserList)
      sharedVars.sockets.push(socket)

      spawnOpenChatWindows(socket, user._id)
    }
  } else {
    sharedVars.usersOnline[user.username].sockets.push(socket.id)
    utils.sendToSelf(socket, 'joinSuccessfully')

    // sortedUserList = sharedUtils.sortByKeys(sharedVars.usersOnline)
    // utils.sendToAllConnectedClients(io, 'updateUsers', sortedUserList)
    sharedVars.sockets.push(socket)

    spawnOpenChatWindows(socket, user._id)
  }

  updateOnlineBubbles()
}

events.onDisconnect = function (socket) {
  socket.on('disconnect', function (reason) {
    const user = socket.request.user

    if (sharedVars.usersOnline[user.username] !== undefined) {
      const userSockets = sharedVars.usersOnline[user.username].sockets

      if (userSockets.length < 2) {
        delete sharedVars.usersOnline[user.username]
      } else {
        sharedVars.usersOnline[user.username].sockets = userSockets.filter(s => s !== socket.id)
      }

      const o = sharedVars.sockets.findIndex(s => s && s.id === socket.id)
      if (o !== -1) sharedVars.sockets.splice(o, 1)
    }

    if (sharedVars.idleUsers[user.username] !== undefined) {
      const idleSockets = sharedVars.idleUsers[user.username].sockets

      if (idleSockets.length < 2) {
        delete sharedVars.idleUsers[user.username]
      } else {
        sharedVars.idleUsers[user.username].sockets = idleSockets.filter(s => s !== socket.id)
      }

      const i = sharedVars.sockets.findIndex(s => s && s.id === socket.id)
      if (i !== -1) sharedVars.sockets.splice(i, 1)
    }

    // Save lastOnline Time. getUser is an async static; drive it via the
    // promise instead of the dropped node callback.
    userSchema
      .getUser(user._id)
      .then(function (u) {
        if (u) {
          u.lastOnline = new Date()
          return u.save()
        }
      })
      .catch(function (err) {
        winston.warn(err)
      })

    // updateOnlineBubbles()

    if (reason === 'transport error') {
      reason = 'client terminated'
    }

    winston.debug('User disconnected (' + reason + '): ' + user.username + ' - ' + socket.id)
  })
}

module.exports = {
  events,
  eventLoop,
  register
}

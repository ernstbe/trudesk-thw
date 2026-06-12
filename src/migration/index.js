/*
      .                              .o8                     oooo
   .o8                             "888                     `888
 .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
   888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
   888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
   888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
   "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 ========================================================================
 Created:    10/31/2018
 Author:     Chris Brame

 **/

const async = require('async')
const winston = require('../logger')
const semver = require('semver')
const dayjs = require('../helpers/dayjs')
const version = require('../../package.json').version

const SettingsSchema = require('../models/setting')
const userSchema = require('../models/user')
const roleSchema = require('../models/role')
const database = require('../database')
const path = require('path')

const migrations = {}

function performBackup (dbVersion, callback) {
  const child = require('child_process').fork(path.join(__dirname, '../../src/backup/backup'), {
    env: {
      FORK: 1,
      NODE_ENV: global.env,
      MONGOURI: database.connectionuri,
      PATH: process.env.PATH,
      FILENAME: 'PREUPGRADE--trudesk-v' + dbVersion + '-' + dayjs().format('MMDDYYYY_HHmm') + '.zip'
    }
  })
  global.forks.push({ name: 'backup', fork: child })

  let result = null

  child.on('message', function (data) {
    child.kill('SIGINT')
    global.forks = global.forks.filter(function (f) {
      return f.fork !== child
    })

    if (data.error) {
      result = { success: false, error: data.error }
    }

    if (data.success) {
      result = { success: true }
    } else {
      result = { success: false, error: data }
    }
  })

  child.on('close', function () {
    if (!result) {
      return callback({ success: false, error: 'An Unknown Error Occurred' })
    }

    if (result.error) {
      return callback(result)
    }

    return callback(null, result)
  })
}

async function saveVersion (callback) {
  try {
    const setting = await SettingsSchema.getSettingByName('gen:version')

    if (!setting) {
      const s = new SettingsSchema({
        name: 'gen:version',
        value: version
      })
      await s.save()
    } else {
      if (setting.value) setting.value = require('../../package').version
      await setting.save()
    }
    if (typeof callback === 'function') return callback()
  } catch (err) {
    winston.warn(err)
    if (typeof callback === 'function') return callback(err)
  }
}

async function getDatabaseVersion (callback) {
  try {
    const setting = await SettingsSchema.getSettingByName('gen:version')

    if (!setting) {
      if (semver.satisfies(version, '>=1.0.11')) {
        return saveVersion(callback)
      } else throw new Error('Please upgrade to v1.0.7 Exiting...')
    }

    return callback(null, setting.value)
  } catch (err) {
    return callback(err)
  }
}

// eslint-disable-next-line no-unused-vars
function _migrateUserRoles (callback) {
  winston.debug('Migrating Roles...')
  async.waterfall(
    [
      function (next) {
        roleSchema.getRoles(next)
      },
      function (roles, next) {
        const adminRole = roles.find(r => r.normalized === 'admin')
        userSchema.collection
          .updateMany({ role: 'admin' }, { $set: { role: adminRole._id } })
          .then(function (res) {
            if (res && res.result) {
              if (res.result.ok === 1) return next(null, roles)
              else {
                winston.warn(res.message)
                return next(res.message)
              }
            } else {
              return next('Unknown Error Occurred')
            }
          })
          .catch(function (err) {
            return next(err)
          })
      },
      function (roles, next) {
        const supportRole = roles.find(r => r.normalized === 'support')
        userSchema.collection
          .updateMany({ $or: [{ role: 'support' }, { role: 'mod' }] }, { $set: { role: supportRole._id } })
          .then(function (res) {
            if (res && res.result) {
              if (res.result.ok === 1) return next(null, roles)
              else {
                winston.warn(res.message)
                return next(res.message)
              }
            } else {
              return next('Unknown Error Occurred')
            }
          })
          .catch(function (err) {
            return next(err)
          })
      },
      function (roles, next) {
        const userRole = roles.find(r => r.normalized === 'user')
        userSchema.collection
          .updateMany({ role: 'user' }, { $set: { role: userRole._id } })
          .then(function (res) {
            if (res && res.result) {
              if (res.result.ok === 1) return next(null, roles)
              else {
                winston.warn(res.message)
                return next(res.message)
              }
            } else {
              return next('Unknown Error Occurred')
            }
          })
          .catch(function (err) {
            return next(err)
          })
      }
    ],
    callback
  )
}

function createAdminTeamDepartment (callback) {
  const Team = require('../models/team')
  const Department = require('../models/department')
  const Account = require('../models/user')

  async.waterfall(
    [
      function (next) {
        Account.getAdmins({}, next)
      },
      function (admins, next) {
        const adminsIds = admins.map(admin => {
          return admin._id.toString()
        })

        Team.create(
          {
            name: 'Support (Default)',
            members: adminsIds
          },
          next
        )
      },
      function (adminTeam, next) {
        Department.create(
          {
            name: 'Support - All Groups (Default)',
            teams: adminTeam._id,
            allGroups: true,
            groups: []
          },
          next
        )
      }
    ],
    callback
  )
}

function removeAgentsFromGroups (callback) {
  // winston.debug('Migrating Agents from Groups...')
  const groupSchema = require('../models/group')
  groupSchema.getAllGroups(function (err, groups) {
    if (err) return callback(err)
    async.eachSeries(
      groups,
      function (group, next) {
        group.members = group.members.filter(function (member) {
          return !member.role.isAdmin && !member.role.isAgent
        })

        group.save(next)
      },
      callback
    )
  })
}

async function migrateStatusInProgress () {
  const Status = require('../models/ticketStatus')
  const matchingNames = ['Pending', 'In Progress', 'In Bearbeitung', 'Ausstehend']
  await Status.collection.updateMany(
    { name: { $in: matchingNames }, isInProgress: { $exists: false } },
    { $set: { isInProgress: true } }
  )
  await Status.collection.updateMany(
    { isInProgress: { $exists: false } },
    { $set: { isInProgress: false } }
  )
}

// Idempotent counterpart to the legacy `removeAgentsFromGroups` migration
// (which only ran for the v1.0.11 upgrade path). Groups are a customer-side
// concept — agents and admins see every ticket anyway via the role-based
// branch in apiGroups.get, so their presence in a group's members array is
// at best redundant and at worst pollutes sendMailTo and the new PWA group
// filter dropdown with people who don't belong there.
//
// Promotions happen at runtime (admin flips a user from "user" to "support"
// via the accounts API), but the existing update path does NOT strip group
// memberships, so the staleness accumulates. Running this on every boot
// keeps the invariant `(member.role is User) for every group.member` true
// without needing a separate manual cleanup script.
async function stripAgentsFromGroups () {
  const groupSchema = require('../models/group')
  const groups = await groupSchema.getAllGroups()

  let touched = 0
  let removedMembers = 0
  let removedMail = 0

  for (const group of groups) {
    const beforeMembers = group.members.length
    const beforeMail = group.sendMailTo.length

    // `role` is autopopulated on User (see user.js findOne/find hook), so
    // `member.role.isAdmin` / `.isAgent` resolve via the role virtual that
    // reads the global.roles cache populated by permissions.register().
    group.members = group.members.filter(m => !m.role.isAdmin && !m.role.isAgent)
    group.sendMailTo = group.sendMailTo.filter(m => !m.role.isAdmin && !m.role.isAgent)

    const droppedMembers = beforeMembers - group.members.length
    const droppedMail = beforeMail - group.sendMailTo.length

    if (droppedMembers === 0 && droppedMail === 0) continue

    await group.save()
    touched++
    removedMembers += droppedMembers
    removedMail += droppedMail
    winston.info(
      `stripAgentsFromGroups: "${group.name}" — removed ${droppedMembers} agent member(s), ${droppedMail} mail recipient(s)`
    )
  }

  if (touched > 0) {
    winston.info(`stripAgentsFromGroups: cleaned ${touched} group(s), ${removedMembers} member(s), ${removedMail} mail recipient(s)`)
  }
}

// Until PR #106 the checklistParser stored titles entity-encoded (the
// sanitize-html default: & as &amp;, < as &lt;, ...). Existing documents in
// tickettemplates / recurringtasks / tickets may still carry escaped titles.
// Entity-decoding is NOT idempotent — a title that legitimately contains
// "&amp;" would lose another layer on every pass — so unlike the always-run
// steps above this one is gated behind a settings flag and runs exactly once.
// The flag is only written after a successful pass, so a failed run retries
// on the next boot.
const DECODE_CHECKLIST_TITLES_FLAG = 'migration:decodeChecklistTitles:done'

async function decodeChecklistTitles () {
  const flag = await SettingsSchema.getSettingByName(DECODE_CHECKLIST_TITLES_FLAG)
  if (flag && flag.value === true) return

  const { decodeEntities } = require('../controllers/api/v2/checklistParser')
  const collections = [
    require('../models/ticketTemplate').collection,
    require('../models/recurringTask').collection,
    require('../models/ticket').collection
  ]

  let updated = 0
  for (const collection of collections) {
    const cursor = collection.find(
      { 'checklist.title': /&(?:amp|lt|gt|quot|#39);/ },
      { projection: { checklist: 1 } }
    )
    for await (const doc of cursor) {
      if (!Array.isArray(doc.checklist)) continue

      let changed = false
      const checklist = doc.checklist.map(item => {
        if (!item || typeof item.title !== 'string') return item
        const decoded = decodeEntities(item.title)
        if (decoded === item.title) return item
        changed = true
        return { ...item, title: decoded }
      })
      if (!changed) continue

      await collection.updateOne({ _id: doc._id }, { $set: { checklist } })
      updated++
      winston.info(`decodeChecklistTitles: decoded checklist titles on ${collection.collectionName}/${doc._id}`)
    }
  }

  if (updated > 0) winston.info(`decodeChecklistTitles: decoded checklist titles on ${updated} document(s)`)

  await SettingsSchema.collection.updateOne(
    { name: DECODE_CHECKLIST_TITLES_FLAG },
    { $set: { value: true } },
    { upsert: true }
  )
}

function createTicketStatus (callback) {
  const Status = require('../models/ticketStatus')
  const counterSchema = require('../models/counters')
  let newId = ''
  let openId = ''
  let pendingId = ''
  let closedId = ''
  async.series(
    [
      function (next) {
        Status.deleteMany({}, next)
      },
      function (next) {
        Status.create(
          [
            {
              name: 'New',
              htmlColor: '#29b955',
              uid: 0,
              order: 0,
              isResolved: false,
              slatimer: true,
              isLocked: true
            },
            {
              name: 'Open',
              htmlColor: '#d32f2f',
              uid: 1,
              order: 1,
              isResolved: false,
              slatimer: true,
              isLocked: true
            },
            {
              name: 'Pending',
              htmlColor: '#2196F3',
              uid: 2,
              order: 2,
              isResolved: false,
              slatimer: false,
              isLocked: true
            },
            {
              name: 'Closed',
              htmlColor: '#CCCCCC',
              uid: 3,
              order: 3,
              isResolved: true,
              slatimer: false,
              isLocked: true
            }
          ],
          function (err, result) {
            if (err) return next(err)
            newId = result[0]._id
            openId = result[1]._id
            pendingId = result[2]._id
            closedId = result[3]._id

            return next()
          }
        )
      },
      function (next) {
        winston.info('Updating ticket statuses for migration. Please Wait...')
        winston.debug('Status [New ID]: ' + newId)
        winston.debug('Status [Open ID]: ' + openId)
        winston.debug('Status [Pending ID]: ' + pendingId)
        winston.debug('Status [Closed ID]: ' + closedId)

        const newPromise = database.db.connection.db
          .collection('tickets')
          .updateMany({ status: 0 }, { $set: { status: newId } })

        const openPromise = database.db.connection.db
          .collection('tickets')
          .updateMany({ status: 1 }, { $set: { status: openId } })

        const pendingPromise = database.db.connection.db
          .collection('tickets')
          .updateMany({ status: 2 }, { $set: { status: pendingId } })

        const closedPromise = database.db.connection.db
          .collection('tickets')
          .updateMany({ status: 3 }, { $set: { status: closedId } })

        Promise.allSettled([newPromise, openPromise, pendingPromise, closedPromise])
          .then(res => {
            return next()
          })
          .catch(err => {
            return next(err)
          })
      },
      async function (next) {
        winston.info('Completed updating ticket status.')
        try {
          await counterSchema.setCounter('status', 4)
          next()
        } catch (err) {
          next(err)
        }
      }
    ],
    callback
  )
}

migrations.run = function (callback) {
  let databaseVersion

  async.series(
    [
      function (next) {
        getDatabaseVersion(function (err, dbVer) {
          if (err) return next(err)
          databaseVersion = dbVer

          if (semver.satisfies(databaseVersion, '<1.0.10')) {
            throw new Error('Please upgrade to v1.0.10 Exiting...')
          }
          return next()
        })
      },
      function (next) {
        if (semver.satisfies(semver.coerce(databaseVersion).version, '<1.0.11')) {
          async.parallel(
            [
              function (done) {
                removeAgentsFromGroups(done)
              },
              function (done) {
                createAdminTeamDepartment(done)
              }
            ],
            next
          )
        } else {
          return next()
        }
      },
      function (next) {
        if (semver.satisfies(semver.coerce(databaseVersion).version, '<1.2.8')) {
          performBackup(databaseVersion, function (err) {
            if (err) return next(err)

            return createTicketStatus(next)
          })
        } else {
          return next()
        }
      },
      function (next) {
        migrateStatusInProgress()
          .then(() => next())
          .catch(err => {
            winston.warn('migrateStatusInProgress failed: ' + err.message)
            return next()
          })
      },
      function (next) {
        stripAgentsFromGroups()
          .then(() => next())
          .catch(err => {
            winston.warn('stripAgentsFromGroups failed: ' + err.message)
            return next()
          })
      },
      function (next) {
        decodeChecklistTitles()
          .then(() => next())
          .catch(err => {
            winston.warn('decodeChecklistTitles failed: ' + err.message)
            return next()
          })
      }
    ],
    function (err) {
      if (err) return callback(err)
      //  Update DB Version Num
      return saveVersion(callback)
    }
  )
}

// Exported for tests.
migrations.decodeChecklistTitles = decodeChecklistTitles

module.exports = migrations

const Department = require('../models/department')
const Group = require('../models/group')

// -------------------------------------------------------------------
// Single source of truth for "which groups may this user see".
//
// The THW deployment splits tickets across a Jugend/Stab group boundary:
// a Jugend agent must never see Stab tickets and vice versa. Admins/agents
// see the groups reachable through their team→department mapping (an admin
// department with allGroups=true therefore sees everything); every other
// user only sees groups they are a direct member of.
//
// This mirrors the gate the single-ticket read (ticketsV2.single) and the
// ticket list (ticketsV2.get) apply, and MUST stay identical to them so the
// calendar / dashboard / group endpoints can never surface tickets the user
// could not open individually. Returns an array of group ObjectIds.
// -------------------------------------------------------------------
async function resolveVisibleGroups (user) {
  let groups = []
  if (user.role.isAdmin || user.role.isAgent) {
    const dbGroups = await Department.getDepartmentGroupsOfUser(user._id)
    groups = dbGroups.map(g => g._id)
  } else {
    groups = await Group.getAllGroupsOfUser(user._id)
  }
  const ids = groups.map(g => g._id)

  // #privatetickets — Group.getAllGroups()/Department.getDepartmentGroupsOfUser's
  // allGroups branch now excludes private groups entirely (so they never leak
  // to OTHER users), which means the admin/agent branch above never picks up
  // the caller's OWN private group either (it isn't mapped to any department).
  // The membership branch already includes it naturally, but merge
  // unconditionally here so both paths behave identically and a private
  // group is exactly as visible to its owner as any other group they belong to.
  const ownPrivate = await Group.getOwnPrivateGroup(user._id)
  if (ownPrivate && !ids.some(id => id.toString() === ownPrivate._id.toString())) {
    ids.push(ownPrivate._id)
  }

  return ids
}

// Throws a 403-tagged error if the ticket's group is not visible to the
// user — the same gate the single-ticket read (ticketsV2.single) applies.
// The v2 write paths fetch a ticket by id/uid before mutating it; without
// this guard a user holding the generic tickets:update / tickets:delete
// grant could modify or delete a ticket in a group they cannot see (e.g.
// Jugend touching Stab tickets). Pass `preResolved` (a string[] of group
// ids) to reuse one lookup across a batch. Returns the resolved id list.
async function assertTicketGroupVisible (user, ticket, preResolved) {
  const visible = preResolved || (await resolveVisibleGroups(user)).map(g => g.toString())
  const gid = ticket && ticket.group ? (ticket.group._id || ticket.group).toString() : null
  if (!gid || !visible.includes(gid)) {
    const err = new Error('Forbidden')
    err.statusCode = 403
    throw err
  }
  return visible
}

// #privatetickets — merges the caller's own private group into a group-LIST
// response if it isn't already present. resolveVisibleGroups above governs
// ticket AUTHORIZATION; this governs what a group picker/dropdown DISPLAYS
// (GET /groups, v1 and v2) — a separate code path that needs the same fix
// so the private group actually shows up for its owner to pick.
async function mergeOwnPrivateGroup (groups, userId) {
  const ownPrivate = await Group.getOwnPrivateGroup(userId)
  if (!ownPrivate) return groups
  const alreadyIncluded = groups.some(g => g._id.toString() === ownPrivate._id.toString())
  return alreadyIncluded ? groups : groups.concat(ownPrivate)
}

// -------------------------------------------------------------------
// Assignee gate: every account set as (additional) assignee must itself be
// able to see the ticket's group — otherwise a user from another team could
// hand a ticket to someone who can't even open it (and the notification /
// subscriber fan-out would leak the ticket across the Jugend/Stab boundary).
// "Can see" is exactly resolveVisibleGroups, so assignability and read
// access can never drift apart. Throws a 403-tagged error naming the
// offending account; `statusCode` serves the v2 handlers, `status` the v1
// create handler. Unknown/deleted accounts are rejected the same way.
// -------------------------------------------------------------------
async function assertUsersCanAccessGroup (userIds, groupId) {
  if (!groupId) return
  const ids = [...new Set((userIds || []).filter(Boolean).map(id => (id._id || id).toString()))]
  if (ids.length === 0) return

  const User = require('../models/user')
  const gid = (groupId._id || groupId).toString()
  const users = await User.find({ _id: { $in: ids }, deleted: false })

  for (const id of ids) {
    const user = users.find(u => u._id.toString() === id)
    let allowed = false
    if (user && user.role) {
      const visible = (await resolveVisibleGroups(user)).map(g => g.toString())
      allowed = visible.includes(gid)
    }
    if (!allowed) {
      const name = user && user.fullname ? user.fullname : id
      const err = new Error('Forbidden: ' + name + ' has no access to the ticket group')
      err.statusCode = 403
      err.status = 403
      throw err
    }
  }
}

module.exports = { resolveVisibleGroups, assertTicketGroupVisible, mergeOwnPrivateGroup, assertUsersCanAccessGroup }

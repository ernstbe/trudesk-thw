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
  return groups.map(g => g._id)
}

module.exports = { resolveVisibleGroups }

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
 *  Updated:    1/20/19 4:46 PM
 *  Copyright (c) 2014-2019. All rights reserved.
 */

const mongoose = require('mongoose')
const utils = require('../helpers/utils')

const COLLECTION = 'groups'

/**
 * Group Schema
 * @module models/ticket
 * @class Group
 * @requires {@link User}
 *
 * @property {object} _id ```Required``` ```unique``` MongoDB Object ID
 * @property {String} name ```Required``` ```unique``` Name of Group
 * @property {Array} members Members in this group
 * @property {Array} sendMailTo Members to email when a new / updated ticket has triggered
 * @property {Boolean} private Hidden single-member "private tickets" group (#privatetickets)
 */
const groupSchema = mongoose.Schema({
  name: { type: String, required: true, unique: true },
  members: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'accounts',
      autopopulate: { select: '-hasL2Auth -preferences -__v' }
    }
  ],
  sendMailTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'accounts' }],
  public: { type: Boolean, required: true, default: false },
  // Unrelated to `public` above (that WIDENS visibility to tickets:public
  // holders). `private` marks a hidden, single-member group auto-created
  // per user for tickets only they can see — excluded from every "list all
  // groups" static below so it never surfaces in another user's dropdown
  // or admin group list. Not to be confused with the OTHER existing
  // per-user group convention: createPublicAccount/pubNewIssue auto-create
  // a `{ name: email, public: true }` group for self-registered users —
  // that one is deliberately visible to staff, the opposite direction.
  private: { type: Boolean, default: false }
})

groupSchema.plugin(require('mongoose-autopopulate'))

groupSchema.pre('save', function () {
  this.name = utils.sanitizeFieldPlainText(this.name.trim())
})

groupSchema.methods.addMember = async function (memberId) {
  const self = this
  if (memberId === undefined) {
    throw new Error('Invalid MemberId - $Group.AddMember()')
  }

  if (self.members === null) self.members = []
  if (isMember(self.members, memberId)) {
    return false
  }

  self.members.push(memberId)
  self.members = [...new Set(self.members)]

  return true
}

groupSchema.methods.removeMember = async function (memberId) {
  const self = this
  if (memberId === undefined) {
    throw new Error('Invalid MemberId - $Group.RemoveMember()')
  }

  if (!isMember(self.members, memberId)) {
    return false
  }

  const memberToRemove = self.members.find(m => m._id.toString() === memberId.toString())
  self.members.splice(self.members.indexOf(memberToRemove), 1)
  self.members = [...new Set(self.members)]

  return true
}

groupSchema.methods.isMember = function (memberId) {
  return isMember(this.members, memberId)
}

groupSchema.methods.addSendMailTo = async function (memberId) {
  if (memberId === undefined) throw new Error('Invalid MemberId - $Group.AddSendMailTo()')

  if (this.sendMailTo === null) this.sendMailTo = []

  if (isMember(this.sendMailTo, memberId)) return false

  this.sendMailTo.push(memberId)
  this.sendMailTo = [...new Set(this.sendMailTo)]

  return true
}

groupSchema.methods.removeSendMailTo = async function (memberId) {
  if (memberId === undefined) throw new Error('Invalid MemberId - $Group.RemoveSendMailTo()')

  if (!isMember(this.sendMailTo, memberId)) return false

  const mailMemberToRemove = this.sendMailTo.find(m => m._id.toString() === memberId.toString())
  this.sendMailTo.splice(this.sendMailTo.indexOf(mailMemberToRemove), 1)

  return true
}

groupSchema.statics.getGroupByName = async function (name) {
  if (name === undefined || name.length < 1) throw new Error('Invalid Group Name - GroupSchema.GetGroupByName()')

  const q = this.model(COLLECTION)
    .findOne({ name })
    .populate('members', '_id username fullname email role preferences image title deleted')
    .populate('sendMailTo', '_id username fullname email role preferences image title deleted')

  return q.exec()
}

groupSchema.statics.getWithObject = async function (obj) {
  const limit = obj.limit ? Number(obj.limit) : 100
  const page = obj.page ? Number(obj.page) : 0
  const userId = obj.userId

  if (userId) {
    // Membership-scoped — the private group's own owner IS a member, so it
    // stays included here without a special case.
    return this.model(COLLECTION)
      .find({ members: userId })
      .limit(limit)
      .skip(page * limit)
      .populate('members', '_id username fullname email role preferences image title deleted')
      .populate('sendMailTo', '_id username fullname email role preferences image title deleted')
      .sort('name')
      .exec()
  }

  return this.model(COLLECTION)
    .find({ private: { $ne: true } })
    .limit(limit)
    .skip(page * limit)
    .populate('members', '_id username fullname email role preferences image title deleted')
    .populate('sendMailTo', '_id username fullname email role preferences image title deleted')
    .sort('name')
    .exec()
}

// "List every group" — excludes private groups (mirrors the deleted:false
// convention on user/ticket/comment/note). This is the single highest-
// leverage fix for #privatetickets: Department.getDepartmentGroupsOfUser's
// allGroups:true branch calls this directly, so an admin/agent whose
// department sees "all groups" never sweeps in anyone's private group.
groupSchema.statics.getAllGroups = async function () {
  const q = this.model(COLLECTION)
    .find({ private: { $ne: true } })
    .populate('members', '_id username fullname email role preferences image title deleted')
    .populate('sendMailTo', '_id username fullname email role preferences image title deleted')
    .sort('name')

  return q.exec()
}

groupSchema.statics.getAllGroupsNoPopulate = async function () {
  const q = this.model(COLLECTION)
    .find({ private: { $ne: true } })
    .sort('name')

  return q.exec()
}

groupSchema.statics.getAllPublicGroups = async function () {
  const q = this.model(COLLECTION)
    .find({ public: true })
    .sort('name')

  return q.exec()
}

groupSchema.statics.getGroups = async function (groupIds) {
  if (groupIds === undefined) {
    throw new Error('Invalid Array of Group IDs - GroupSchema.GetGroups()')
  }

  return this.model(COLLECTION)
    .find({ _id: { $in: groupIds } })
    .populate('members', '_id username fullname email role preferences image title deleted')
    .sort('name')
    .exec()
}

groupSchema.statics.getAllGroupsOfUser = async function (userId) {
  if (userId === undefined) {
    throw new Error('Invalid UserId - GroupSchema.GetAllGroupsOfUser()')
  }

  const q = this.model(COLLECTION)
    .find({ members: userId })
    .populate('members', '_id username fullname email role preferences image title deleted')
    .populate('sendMailTo', '_id username fullname email role preferences image title deleted')
    .sort('name')

  return q.exec()
}

groupSchema.statics.getAllGroupsOfUserNoPopulate = async function (userId) {
  if (userId === undefined) throw new Error('Invalid UserId - GroupSchema.GetAllGroupsOfUserNoPopulate()')

  const q = this.model(COLLECTION)
    .find({ members: userId })
    .sort('name')

  return q.exec()
}

// #privatetickets — the caller's own hidden group, if they've enabled the
// feature. Deliberately NOT populated: callers that need it just need the
// _id to merge into a visible-groups list.
groupSchema.statics.getOwnPrivateGroup = async function (userId) {
  if (userId === undefined) throw new Error('Invalid UserId - GroupSchema.GetOwnPrivateGroup()')

  return this.model(COLLECTION)
    .findOne({ private: true, members: userId })
    .exec()
}

// Idempotent: returns the existing private group if the user already has
// one (Settings toggle can be flipped on repeatedly without duplicating
// it), otherwise creates one. `sendMailTo` stays empty — the owner already
// gets normal notifications as the ticket's owner/subscriber, no group-
// level mail fan-out needed for a group with exactly one member.
groupSchema.statics.getOrCreatePrivateGroup = async function (user) {
  if (!user || !user._id) throw new Error('Invalid User - GroupSchema.GetOrCreatePrivateGroup()')

  const existing = await this.model(COLLECTION).getOwnPrivateGroup(user._id)
  if (existing) return existing

  return this.model(COLLECTION).create({
    name: 'private:' + user._id.toString(),
    members: [user._id],
    sendMailTo: [],
    private: true
  })
}

groupSchema.statics.getGroupById = async function (gId) {
  if (gId === undefined) throw new Error('Invalid GroupId - GroupSchema.GetGroupById()')

  const q = this.model(COLLECTION)
    .findOne({ _id: gId })
    .populate('members', '_id username fullname email role preferences image title')
    .populate('sendMailTo', '_id username fullname email role preferences image title')

  return q.exec()
}

function isMember (arr, id) {
  // Mirror of team.js: treat null/undefined member arrays as "no members"
  // instead of crashing on .filter when legacy docs lack the array.
  if (!Array.isArray(arr)) return false

  const matches = arr.filter(function (value) {
    return value._id.toString() === id.toString()
  })

  return matches.length > 0
}

module.exports = mongoose.model(COLLECTION, groupSchema)

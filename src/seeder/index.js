var winston = require('../logger')
var _ = require('lodash')

var seeder = {}

seeder.init = async function (callback) {
  var GroupSchema = require('../models/group')
  var TeamSchema = require('../models/team')
  var DepartmentSchema = require('../models/department')

  try {
    var groupCount = await GroupSchema.countDocuments()
    var teamCount = await TeamSchema.countDocuments()
    var deptCount = await DepartmentSchema.countDocuments()

    if (groupCount > 0 || teamCount > 0 || deptCount > 0) {
      winston.debug('Seeder: Data already exists, skipping')
    } else {
      winston.debug('Seeder: No groups, teams, or departments found. Creating seed data...')

      // 1. Create Groups
      var allgemeinGroup = await GroupSchema.create({ name: 'Allgemein', public: true })
      var einsatzGroup = await GroupSchema.create({ name: 'Einsatz', public: false })
      var verwaltungGroup = await GroupSchema.create({ name: 'Verwaltung', public: false })
      var itGroup = await GroupSchema.create({ name: 'IT & Kommunikation', public: false })
      var jugendGroup = await GroupSchema.create({ name: 'Jugend', public: false })
      var kuecheGroup = await GroupSchema.create({ name: 'Küche', public: false })
      var liegenschaftenGroup = await GroupSchema.create({ name: 'Liegenschaften', public: false })
      winston.debug('Seeder: Created 7 groups')

      // 2. Create Teams
      var s1Team = await TeamSchema.create({ name: 'S1 - Personal' })
      var s3Team = await TeamSchema.create({ name: 'S3 - Einsatz' })
      var s4Team = await TeamSchema.create({ name: 'S4 - Versorgung' })
      var s6Team = await TeamSchema.create({ name: 'S6 - IuK' })
      var jugendTeam = await TeamSchema.create({ name: 'Jugend' })
      var kuecheTeam = await TeamSchema.create({ name: 'Küche' })
      winston.debug('Seeder: Created 6 teams')

      // 3. Create Departments (reference teams and groups)
      await DepartmentSchema.create({
        name: 'Verwaltung',
        teams: [s1Team._id],
        groups: [allgemeinGroup._id, verwaltungGroup._id]
      })
      await DepartmentSchema.create({
        name: 'Einsatz',
        teams: [s3Team._id],
        groups: [einsatzGroup._id]
      })
      await DepartmentSchema.create({
        name: 'IT-Support',
        teams: [s6Team._id],
        groups: [itGroup._id]
      })
      await DepartmentSchema.create({
        name: 'Jugend',
        teams: [jugendTeam._id],
        groups: [jugendGroup._id]
      })
      await DepartmentSchema.create({
        name: 'Küche',
        teams: [kuecheTeam._id],
        groups: [kuecheGroup._id]
      })
      await DepartmentSchema.create({
        name: 'Liegenschaften',
        teams: [s4Team._id],
        groups: [liegenschaftenGroup._id]
      })
      winston.debug('Seeder: Created 6 departments')

      winston.info('Seeder: Finished — created 7 groups, 6 teams, 6 departments')
    }

    // Seed ticket types and tags (idempotent — skips if they already exist)
    await seedTicketTypes()
    await seedTags()
  } catch (err) {
    winston.warn('Seeder: Error during seeding — ' + err.message)
  }

  if (_.isFunction(callback)) return callback()
}

async function seedTicketTypes () {
  var TicketTypeSchema = require('../models/tickettype')
  var PrioritySchema = require('../models/ticketpriority')

  var thwTypes = ['Gebaeude/Liegenschaften', 'Beschaffung', 'Beschluss']

  var priorities = await PrioritySchema.find({})
  var priorityIds = priorities.map(function (p) { return p._id })

  for (var i = 0; i < thwTypes.length; i++) {
    var existing = await TicketTypeSchema.getTypeByName(thwTypes[i])
    if (!existing) {
      await TicketTypeSchema.create({ name: thwTypes[i], priorities: priorityIds })
      winston.debug('Seeder: Created ticket type "' + thwTypes[i] + '"')
    }
  }
}

async function seedTags () {
  var TagSchema = require('../models/tag')

  var thwTags = [
    'Reparatur', 'Defekt', 'Wartung', 'Pruefung', 'Sicherheit',
    'Heizung', 'Elektrik', 'Sanitaer', 'Dach', 'Aussengelaende'
  ]

  for (var i = 0; i < thwTags.length; i++) {
    var count = await TagSchema.tagExist(thwTags[i])
    if (count === 0) {
      await TagSchema.create({ name: thwTags[i] })
      winston.debug('Seeder: Created tag "' + thwTags[i] + '"')
    }
  }
}

module.exports = seeder

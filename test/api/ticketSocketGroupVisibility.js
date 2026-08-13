const expect = require('chai').expect
const ioClient = require('socket.io-client')

const groupSchema = require('../../src/models/group')
const ticketModel = require('../../src/models/ticket')
const userSchema = require('../../src/models/user')
const tickettype = require('../../src/models/tickettype')
const prioritySchema = require('../../src/models/ticketpriority')
const statusSchema = require('../../src/models/ticketStatus')
const emitter = require('../../src/emitter')

// Regression coverage for GH-134: every ticket socket event (ticketSocket.js
// AND the emitter listeners in src/emitter/events.js, which is the path v1/
// v2 REST mutations actually go through) used to fan out via a global
// io.sockets.emit, so a Jugend-scoped socket received full Stab ticket
// content. Sockets now join a room per resolveVisibleGroups(user) group on
// connect (socketserver.js#joinVisibleGroupRooms) and ticket events are
// scoped to the ticket's group room (ticketSocket.js#groupRoom /
// #broadcastToTicketGroup, events.js#broadcastToTicketGroup).
describe('ticket socket events — group visibility enforcement', function () {
  this.timeout(15000)

  const baseUrl = 'http://localhost:3111'
  const adminToken = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

  let testGroupId
  let forbiddenGroup
  let visibleTicket
  let foreignTicket

  before(async function () {
    const group = await groupSchema.getGroupByName('TEST')
    testGroupId = group._id

    forbiddenGroup = await groupSchema.create({ name: 'Socket Forbidden Group' })

    const owner = await userSchema.getUserByUsername('trudesk')
    const type = await tickettype.getTypeByName('Task')
    let priority = await prioritySchema.findOne({ default: true })
    if (!priority) priority = await prioritySchema.findOne({})
    const status = await statusSchema.findOne({ uid: 0 })

    visibleTicket = await ticketModel.create({
      owner: owner._id,
      group: testGroupId,
      type: type._id,
      status: status._id,
      priority: priority._id,
      subject: 'Socket visibility — visible ticket',
      issue: 'fixture'
    })

    foreignTicket = await ticketModel.create({
      owner: owner._id,
      group: forbiddenGroup._id,
      type: type._id,
      status: status._id,
      priority: priority._id,
      subject: 'Socket visibility — foreign ticket',
      issue: 'fixture'
    })
  })

  after(async function () {
    if (visibleTicket) await ticketModel.deleteOne({ _id: visibleTicket._id })
    if (foreignTicket) await ticketModel.deleteOne({ _id: foreignTicket._id })
    if (forbiddenGroup) await groupSchema.deleteOne({ _id: forbiddenGroup._id })
  })

  function connectAndJoin () {
    return new Promise(function (resolve, reject) {
      const socket = ioClient(baseUrl, { query: { token: adminToken }, forceNew: true })
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000)
      socket.on('connect', () => {
        clearTimeout(timer)
        // joinVisibleGroupRooms runs async after 'connection' — give it a
        // beat to resolve the group lookup and call socket.join() before
        // the test starts emitting.
        setTimeout(() => resolve(socket), 300)
      })
      socket.on('connect_error', err => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  it('delivers a ticket:updated event only to sockets in the ticket\'s group', async function () {
    const socket = await connectAndJoin()
    try {
      const received = []
      socket.on('$trudesk:client:ticket:updated', payload => received.push(payload))

      emitter.emit('ticket:updated', foreignTicket)
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(received).to.have.lengthOf(0)

      emitter.emit('ticket:updated', visibleTicket)
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(received).to.have.lengthOf(1)
      expect(received[0].ticket._id.toString()).to.equal(visibleTicket._id.toString())
    } finally {
      socket.disconnect()
    }
  })
})

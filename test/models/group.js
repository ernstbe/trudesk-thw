const expect = require('chai').expect
const m = require('mongoose')
const groupSchema = require('../../src/models/group')
const userSchema = require('../../src/models/user')
const roleSchema = require('../../src/models/role')

describe('group.js', function () {
  const groupId = new m.Types.ObjectId()
  const memberId1 = new m.Types.ObjectId()
  const memberId2 = new m.Types.ObjectId()
  const memberId3 = new m.Types.ObjectId()

  const nonMember1 = new m.Types.ObjectId()

  it('should create a group', async function () {
    const group = await groupSchema.create({
      _id: groupId,
      name: 'Test Group',
      members: [memberId1, memberId2, memberId3],
      sendMailTo: []
    })
    expect(group).to.be.a('object')
    expect(group._doc).to.include.keys('_id', 'name', 'members', 'sendMailTo')
  })

  it('should get all groups', async function () {
    const group = await groupSchema.getAllGroups()
    expect(group).to.have.length(2)
  })

  it('should get group by id', async function () {
    const groups = await groupSchema.getGroupById(groupId)
    expect(groups).to.be.a('object')
  })

  it('should add group member', async function () {
    const group = await groupSchema.getGroupByName('Test Group')
    expect(group).to.be.a('object')

    const success = await group.addMember(nonMember1)
    expect(success).to.equal(true)

    const success2 = await group.addMember(memberId1)
    expect(success2).to.equal(true)
  })

  it('should remove group member', async function () {
    const group = await groupSchema.getGroupByName('Test Group')
    expect(group).to.be.a('object')
    const mem = {
      _id: memberId2
    }
    group.members = [mem]
    const success = await group.removeMember(memberId2)
    expect(success).to.equal(true)
  })

  describe('#privatetickets', function () {
    // Group.members refs 'accounts' with autopopulate-on-save — populating a
    // member id with no matching account document leaves it null, so this
    // needs a real persisted user rather than a bare ObjectId.
    let owner
    let ownerId

    before(async function () {
      const userRole = (await roleSchema.getRoles()).find(r => r.normalized === 'user')
      owner = await userSchema.create({
        username: 'group.privatetickets.owner',
        password: '$2a$04$350Dkwcq9EpJLFhbeLB0buFcyFkI9q3edQEPpy/zqLjROMD9LPToW',
        fullname: 'Group Private Tickets Owner',
        email: 'group.privatetickets.owner@trudesk.io',
        role: userRole._id,
        accessToken: 'group-privatetickets-owner-token'
      })
      ownerId = owner._id
    })

    after(async function () {
      await groupSchema.deleteMany({ private: true, members: ownerId })
      if (owner) await userSchema.deleteOne({ _id: owner._id })
    })

    it('should create a private group on first call', async function () {
      const group = await groupSchema.getOrCreatePrivateGroup({ _id: ownerId })
      expect(group).to.be.a('object')
      expect(group.private).to.equal(true)
      expect(group.members.map(id => (id._id || id).toString())).to.include(ownerId.toString())
    })

    it('should return the same private group on subsequent calls (idempotent)', async function () {
      const first = await groupSchema.getOrCreatePrivateGroup({ _id: ownerId })
      const second = await groupSchema.getOrCreatePrivateGroup({ _id: ownerId })
      expect(second._id.toString()).to.equal(first._id.toString())
    })

    it('getOwnPrivateGroup should find the owner private group', async function () {
      const group = await groupSchema.getOwnPrivateGroup(ownerId)
      expect(group).to.be.a('object')
      expect(group.private).to.equal(true)
    })

    it('should exclude private groups from getAllGroups', async function () {
      const groups = await groupSchema.getAllGroups()
      const privateIncluded = groups.some(g => g.private === true)
      expect(privateIncluded).to.equal(false)
    })
  })
})

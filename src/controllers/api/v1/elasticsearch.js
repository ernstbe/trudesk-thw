/*
      .                             .o8                     oooo
   .o8                             "888                     `888
 .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
   888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
   888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
   888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
   "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 ========================================================================
 Created:    10/15/2018
 Author:     Chris Brame

 **/

const es = require('../../../elasticsearch')
const ticketSchema = require('../../../models/ticket')
const groupSchema = require('../../../models/group')

const apiElasticSearch = {}

apiElasticSearch.rebuild = function (req, res) {
  es.rebuildIndex()

  return res.json({ success: true })
}

apiElasticSearch.status = async function (req, res) {
  const response = {
    esStatus: global.esStatus
  }

  try {
    // ticketSchema.getCount is an async static now; the old async.parallel fed
    // it a node callback that was dropped, so dbCount stayed undefined and the
    // response never sent. es.getIndexCount is still callback-based, so wrap it.
    const [indexData, dbCount] = await Promise.all([
      new Promise(function (resolve, reject) {
        es.getIndexCount(function (err, data) {
          if (err) return reject(err)
          return resolve(data)
        })
      }),
      ticketSchema.getCount()
    ])

    response.indexCount = indexData && indexData.count !== undefined ? indexData.count : 0
    response.dbCount = dbCount
    response.inSync = response.dbCount === response.indexCount

    return res.json({ success: true, status: response })
  } catch (err) {
    return res.status(500).json({ success: false, error: err })
  }
}

apiElasticSearch.search = async function (req, res) {
  let limit = (req.query.limit !== undefined ? req.query.limit : 100)
  try {
    limit = parseInt(limit)
  } catch (e) {
    limit = 100
  }

  try {
    // getAllGroupsOfUserNoPopulate is an async static; the dropped callback
    // meant this handler never resolved the user's groups nor sent a response.
    const groups = await groupSchema.getAllGroupsOfUserNoPopulate(req.user._id)

    const g = groups.map(function (i) { return i._id })

    const obj = {
      index: 'trudesk',
      size: limit,
      from: 0,
      query: {
        bool: {
          must: {
            multi_match: {
              query: req.query.q,
              type: 'cross_fields',
              operator: 'and',
              fields: [
                'uid^5',
                'subject^4',
                'issue^4',
                'owner.fullname',
                'owner.username',
                'owner.email',
                'comments.owner.email',
                'tags.normalized',
                'priority.name',
                'type.name',
                'group.name',
                'comments.comment^3',
                'notes.note^3',
                'dateFormatted'
              ],
              tie_breaker: 0.3
            }
          },
          filter: {
            terms: { 'group._id': g }
          }
        }
      }
    }

    const r = await es.esclient.search(obj)
    return res.send(r)
  } catch (err) {
    return res.status(400).json({ success: false, error: err })
  }
}

module.exports = apiElasticSearch

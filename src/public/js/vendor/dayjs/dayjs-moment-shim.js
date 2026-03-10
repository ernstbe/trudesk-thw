(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory)
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.dayjs = factory()
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var dayjs = require('dayjs')
  var utc = require('dayjs/plugin/utc')
  var timezone = require('dayjs/plugin/timezone')
  var relativeTime = require('dayjs/plugin/relativeTime')
  var duration = require('dayjs/plugin/duration')
  var calendar = require('dayjs/plugin/calendar')
  var customParseFormat = require('dayjs/plugin/customParseFormat')
  var advancedFormat = require('dayjs/plugin/advancedFormat')
  var isBetween = require('dayjs/plugin/isBetween')

  dayjs.extend(utc)
  dayjs.extend(timezone)
  dayjs.extend(relativeTime)
  dayjs.extend(duration)
  dayjs.extend(calendar)
  dayjs.extend(customParseFormat)
  dayjs.extend(advancedFormat)
  dayjs.extend(isBetween)

  return dayjs
}))

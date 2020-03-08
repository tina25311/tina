'use strict'

const resolvePageHelper = require('./resolve-page')

module.exports = (spec, model) => {
  const page = resolvePageHelper(spec, model)
  if (page) return page.pub.url
}

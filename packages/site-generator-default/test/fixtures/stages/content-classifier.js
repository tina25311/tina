'use strict'

const delegate = require('@antora/content-classifier')

function classifyContent (aggregate, siteAsciiDocConfig = {}, context) {
  context.sitePublisher.ping('contentClassifier')
  return delegate(aggregate, siteAsciiDocConfig, context)
}

module.exports = classifyContent

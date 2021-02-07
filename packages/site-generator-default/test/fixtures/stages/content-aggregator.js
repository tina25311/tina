'use strict'

const delegate = require('@antora/content-aggregator')

function aggregateContent (context) {
  context.sitePublisher.ping('contentAggregator')
  return delegate(context)
}

function computeOrigin (url, authStatus, ref, startPath, worktreePath, editUrl = true) {
  return delegate._computeOrigin(url, authStatus, ref, startPath, worktreePath, editUrl)
}

module.exports = aggregateContent
module.exports._computeOrigin = computeOrigin

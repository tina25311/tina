'use strict'

const delegate = require('@antora/page-composer')

function createPageComposer (contentCatalog, uiCatalog, env = process.env, context) {
  context.sitePublisher.ping('pageComposer')
  return delegate(contentCatalog, uiCatalog, env, context)
}

module.exports = createPageComposer

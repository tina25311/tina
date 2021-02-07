'use strict'

const delegate = require('@antora/redirect-producer')

function produceRedirects (contentCatalog, context) {
  context.sitePublisher.ping('redirectProducer')
  return delegate(contentCatalog, context)
}

module.exports = produceRedirects

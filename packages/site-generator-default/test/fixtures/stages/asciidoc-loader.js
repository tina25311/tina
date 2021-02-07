'use strict'

const delegate = require('@antora/asciidoc-loader')

function loadAsciiDoc (file, contentCatalog = undefined, config = {}, context) {
  context.sitePublisher.ping('asciidocLoader.loadAsciiDoc')
  return delegate(file, contentCatalog, config)
}

function extractAsciiDocMetadata (doc, context) {
  context.sitePublisher.ping('asciidocLoader.extractAsciiDocMetadata')
  return delegate.extractAsciiDocMetadata(doc, context)
}

function resolveAsciiDocConfig (context) {
  context.sitePublisher.ping('asciidocLoader.resolveAsciiDocConfig')
  return delegate.resolveAsciiDocConfig(context)
}

module.exports = Object.assign(loadAsciiDoc, {
  loadAsciiDoc,
  extractAsciiDocMetadata,
  resolveAsciiDocConfig,
  // @deprecated scheduled to be removed in Antora 4
  resolveConfig: resolveAsciiDocConfig,
})

'use strict'

const delegate = require('@antora/document-converter')

async function convertDocuments (contentCatalog, siteAsciiDocConfig = {}, context = {}) {
  context.sitePublisher.ping('documentConverter.convertDocuments')
  return delegate(contentCatalog, siteAsciiDocConfig, context)
}

function convertDocument (file, contentCatalog = undefined, asciidocConfig = {}, context) {
  context.sitePublisher.ping('documentConverter.convertDocument')
  return delegate(file, contentCatalog, asciidocConfig, context)
}

module.exports = Object.assign(convertDocuments, { convertDocuments, convertDocument })

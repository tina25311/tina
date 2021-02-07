'use strict'

const delegate = require('@antora/site-mapper')

function mapSite (pages, context) {
  context.sitePublisher.ping('siteMapper')
  return delegate(pages, context)
}

module.exports = mapSite

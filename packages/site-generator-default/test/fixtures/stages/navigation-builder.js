'use strict'

const delegate = require('@antora/navigation-builder')

function buildNavigation (contentCatalog, siteAsciiDocConfig = {}, context) {
  context.sitePublisher.ping('navigationBuilder')
  return delegate(contentCatalog, siteAsciiDocConfig, context)
}

module.exports = buildNavigation

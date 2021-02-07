'use strict'

const delegate = require('@antora/ui-loader')

function loadUi (context) {
  context.sitePublisher.ping('uiLoader')
  return delegate(context)
}

module.exports = loadUi

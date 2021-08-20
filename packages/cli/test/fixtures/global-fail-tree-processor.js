'use strict'

const Asciidoctor = require('@asciidoctor/core')()

Asciidoctor.Extensions.register(function () {
  this.treeProcessor(function () {
    throw 'not today!' // eslint-disable-line no-throw-literal
  })
})

'use strict'

const asciidoctor = require('asciidoctor.js')()

asciidoctor.Extensions.register(function () {
  this.treeProcessor(function () {
    throw 'not today!'
  })
})

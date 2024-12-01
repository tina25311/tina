'use strict'

const Asciidoctor = require('@asciidoctor/core')()

Asciidoctor.Extensions.register(function () {
  this.treeProcessor(() => {
    throw 'not today!'
  })
})

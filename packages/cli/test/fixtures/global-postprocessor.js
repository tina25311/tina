'use strict'

const asciidoctor = require('@asciidoctor/core')()

asciidoctor.Extensions.register(function () {
  this.postprocessor(function () {
    this.process((_, output) => output + '\n<p>Fin!</p>')
  })
})

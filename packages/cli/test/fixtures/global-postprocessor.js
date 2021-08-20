'use strict'

const Asciidoctor = require('@asciidoctor/core')()

Asciidoctor.Extensions.register(function () {
  this.postprocessor(function () {
    this.process((_, output) => output + '\n<p>Fin!</p>')
  })
})

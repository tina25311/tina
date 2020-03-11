'use strict'

module.exports.forMode = function (mode) {
  return mode === 'nav'
}

module.exports.register =  function (registry, config)  {
  registry.preprocessor('navExt', function () {
    this.process((document, reader) => {
      reader.lines.push('* xref:new-page.adoc[New!]')
    })
  })
}

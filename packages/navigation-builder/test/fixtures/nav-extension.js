'use strict'

module.exports.register =  function (registry, config)  {
  registry.preprocessor('navExt', function () {
    this.process((document, reader) => {
      reader.lines.push('* xref:requirements.adoc[Requirements]')
    })
  })
}

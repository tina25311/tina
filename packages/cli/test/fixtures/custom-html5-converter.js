'use strict'

require('@asciidoctor/core')()
const Opal = global.Opal

;(() => {
  const classDef = Opal.klass(null, Opal.Asciidoctor.Converter.$for('html5'), 'CustomHtml5Converter')
  classDef.$register_for('html5')
  Opal.defn(classDef, '$convert_paragraph', (node) => `<p>${node.getContent()}</p>`)
})()

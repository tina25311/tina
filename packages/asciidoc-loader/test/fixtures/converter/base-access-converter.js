'use strict'

module.exports = (next, context) => {
  return {
    name: 'base-access-converter',
    embedded: (node, transform, opts) => {
      //$convert_outline for asciidoctor 2.
      return next.baseConverter.$outline(node)
    },
  }
}

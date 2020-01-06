'use strict'

const Html5Converter = require('./html5')

/**
 * Creates an HTML5 converter instance with Antora enhancements.
 *
 * @memberof asciidoc-loader
 *
 * @param {Object} context - The file, content catalog, and asciidoc config.
 *
 * @returns {Converter} An enhanced instance of Asciidoctor's HTML5 converter, at the end of a chain of templates.
 */
function createConverter (context) {
  var baseConverter = Html5Converter.$new('html5', undefined, context)

  return (context.config.converters ? context.config.converters.reverse() : []).reduce((accum, module) => {
    const custom = module(accum, context)
    return {
      $convert: (node, transform, opts) => {
        const template = custom[transform || node.node_name]
        if (template) {
          return template(node, transform, opts)
        }
        return accum.$convert(node, transform, opts)
      },
    }
  }, baseConverter)
}

module.exports = createConverter

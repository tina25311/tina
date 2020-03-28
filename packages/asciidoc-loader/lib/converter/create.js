'use strict'

const Html5Converter = require('./html5')

/**
 * Creates an HTML5 converter instance with Antora enhancements.
 *
 * @memberof asciidoc-loader
 *
 * @param {Object} callbacks - Callback functions.
 * @param {Function} callbacks.onPageRef - A function that converts a page reference.
 *
 * @returns {Converter} An enhanced instance of Asciidoctor's HTML5 converter.
 */
function createConverter (context) {
  var baseConverter = Html5Converter.$new('html5', undefined, context)
  baseConverter.baseConverter = baseConverter

  return (context.config.converters ? context.config.converters.reverse() : []).reduce((accum, module) => {
    const custom = module(accum, context)
    return {
      // asciidoctor 2?
      convert: (node, transform, opts) => {
        const template = custom[transform || node.node_name]
        if (template) {
          return template(node, transform, opts)
        }
        return accum.convert(node, transform, opts)
      },

      // asciidoctor 1?
      $convert: (node, transform, opts) => {
        const template = custom[transform || node.node_name]
        if (template) {
          return template(node, transform, opts)
        }
        return accum.$convert(node, transform, opts)
      },
      //needed because not all useful methods are accessible via 'convert'
      baseConverter,
    }
  }, baseConverter)
}

module.exports = createConverter

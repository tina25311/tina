'use strict'

module.exports = (baseConverter, context) => {
  return {
    name: 'delegating-converter',
    inline_anchor: (node, transform, opts) => {
      return baseConverter.$convert(node, transform, opts)
    },
    image: (node, transform, opts) => {
      return baseConverter.$convert(node, transform, opts)
    },
    inline_image: (node, transform, opts) => {
      return baseConverter.$convert(node, transform, opts)
    },
  }
}

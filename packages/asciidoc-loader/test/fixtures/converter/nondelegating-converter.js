'use strict'

module.exports = (baseConverter, context) => {
  return {
    name: 'nondelegating-converter',
    anchor_count: 0,
    image_count: 0,
    inline_image_count: 0,
    inline_anchor: (node, transform, opts) => {
    },
    image: (node, transform, opts) => {
    },
    inline_image: (node, transform, opts) => {
    },
  }
}

'use strict'

const Opal = global.Opal
const { $Antora } = require('../constants')
const $pageRefCallback = Symbol('pageRefCallback')
const $imageRefCallback = Symbol('imageRefCallback')

const Html5Converter = (() => {
  const scope = Opal.klass(
    Opal.module(null, 'Antora', $Antora),
    Opal.module(null, 'Asciidoctor').Converter.Html5Converter,
    'Html5Converter',
    function () {}
  )
  Opal.defn(scope, '$initialize', function initialize (backend, opts, callbacks) {
    Opal.send(this, Opal.find_super_dispatcher(this, 'initialize', initialize), [backend, opts])
    this[$pageRefCallback] = callbacks.onPageRef
    this[$imageRefCallback] = callbacks.onImageRef
  })
  Opal.defn(scope, '$inline_anchor', function convertInlineAnchor (node) {
    if (node.getType() === 'xref') {
      let callback
      if (node.getAttribute('path') && (callback = this[$pageRefCallback])) {
        const attrs = node.getAttributes()
        if (attrs.fragment === Opal.nil) delete attrs.fragment
        const { content, target, internal, unresolved } = callback(attrs.refid, node.getText())
        let type
        if (internal) {
          type = 'xref'
          delete attrs.path
          attrs.refid = target.substr(1)
        } else {
          type = 'link'
          attrs.role = `page${unresolved ? ' unresolved' : ''}${attrs.role ? ' ' + attrs.role : ''}`
        }
        const attributes = Opal.hash2(Object.keys(attrs), attrs)
        const options = Opal.hash2(['type', 'target', 'attrs'], { type, target, attributes })
        node = Opal.module(null, 'Asciidoctor').Inline.$new(node.getParent(), 'anchor', content, options)
      }
    }
    return Opal.send(this, Opal.find_super_dispatcher(this, 'inline_anchor', convertInlineAnchor), [node])
  })
  Opal.defn(scope, '$image', function convertImage (node) {
    return Opal.send(
      this,
      Opal.find_super_dispatcher(this, 'image', convertImage),
      [transformImageNode(this, node, node.getAttribute('target'))]
    )
  })
  Opal.defn(scope, '$inline_image', function convertInlineImage (node) {
    return Opal.send(
      this,
      Opal.find_super_dispatcher(this, 'inline_image', convertInlineImage),
      [transformImageNode(this, node, node.getTarget())]
    )
  })
  return scope
})()

function transformImageNode (converter, node, target) {
  let imageRefCallback
  if (matchesResourceSpec(target) && (imageRefCallback = converter[$imageRefCallback])) {
    const alt = node.getAttribute('alt')
    if (node.isAttribute('default-alt', alt, false)) node.setAttribute('alt', alt.split(/[@:]/).pop())
    Opal.defs(node, '$image_uri', (imageSpec) => imageRefCallback(imageSpec) || imageSpec)
  }
  return node
}

function matchesResourceSpec (target) {
  return ~target.indexOf(':')
    ? !(~target.indexOf('://') || (target.startsWith('data:') && ~target.indexOf(',')))
    : target.indexOf('@') > 0
}

module.exports = Html5Converter

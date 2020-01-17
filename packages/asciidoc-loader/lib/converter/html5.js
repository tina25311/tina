'use strict'

const Opal = global.Opal
const { $Antora } = require('../constants')
const convertImageRef = require('../image/convert-image-ref')
const convertPageRef = require('../xref/convert-page-ref')
const $context = Symbol('context')

const Html5Converter = (() => {
  const scope = Opal.klass(
    Opal.module(null, 'Antora', $Antora),
    Opal.module(null, 'Asciidoctor').Converter.Html5Converter,
    'Html5Converter',
    function () {}
  )
  Opal.defn(scope, '$initialize', function initialize (backend, opts, context) {
    Opal.send(this, Opal.find_super_dispatcher(this, 'initialize', initialize), [backend, opts])
    this[$context] = context
  })
  Opal.defn(scope, '$inline_anchor', function convertInlineAnchor (node) {
    if (node.getType() === 'xref') {
      let context
      if (node.getAttribute('path') && (context = this[$context])) {
        const attrs = node.getAttributes()
        if (attrs.fragment === Opal.nil) delete attrs.fragment
        const { content, target, internal, unresolved } =
          convertPageRef(attrs.refid,
            node.getText(),
            context.file,
            context.contentCatalog,
            context.config.relativizePageRefs !== false)
        let options
        if (internal) {
          // QUESTION should we propagate the role in this case?
          options = Opal.hash2(['type', 'target'], { type: 'link', target })
        } else {
          attrs.role = `page${unresolved ? ' unresolved' : ''}${attrs.role ? ' ' + attrs.role : ''}`
          options = Opal.hash2(['type', 'target', 'attrs'], {
            type: 'link',
            target,
            attributes: Opal.hash2(Object.keys(attrs), attrs),
          })
        }
        node = Opal.module(null, 'Asciidoctor').Inline.$new(node.getParent(), 'anchor', content, options)
      }
    }
    return Opal.send(this, Opal.find_super_dispatcher(this, 'inline_anchor', convertInlineAnchor), [node])
  })
  Opal.defn(scope, '$image', function convertImage (node) {
    let context
    if (matchesResourceSpec(node.getAttribute('target')) && (context = this[$context])) {
      const attrs = node.getAttributes()
      if (attrs.alt === attrs['default-alt']) node.setAttribute('alt', attrs.alt.split(/[@:]/).pop())
      Opal.defs(node, '$image_uri', (imageSpec) => convertImageRef(imageSpec, context.file, context.contentCatalog) || imageSpec)
    }
    return Opal.send(this, Opal.find_super_dispatcher(this, 'image', convertImage), [node])
  })
  Opal.defn(scope, '$inline_image', function convertInlineImage (node) {
    let context
    if (matchesResourceSpec(node.target) && (context = this[$context])) {
      const attrs = node.getAttributes()
      if (attrs.alt === attrs['default-alt']) node.setAttribute('alt', attrs.alt.split(/[@:]/).pop())
      Opal.defs(node, '$image_uri', (imageSpec) => convertImageRef(imageSpec, context.file, context.contentCatalog) || imageSpec)
    }
    return Opal.send(this, Opal.find_super_dispatcher(this, 'inline_image', convertInlineImage), [node])
  })
  return scope
})()

function matchesResourceSpec (target) {
  return ~target.indexOf(':')
    ? !(~target.indexOf('://') || (target.startsWith('data:') && ~target.indexOf(',')))
    : target.indexOf('@') > 0
}

module.exports = Html5Converter

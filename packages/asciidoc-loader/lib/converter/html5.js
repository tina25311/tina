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
      const context = this[$context]
      let refSpec = node.getAttribute('path', undefined, false)
      if (refSpec && context) {
        // NOTE handle deprecated case when extension code defines path with no file extension; remove in Antora 3.0
        if (!~refSpec.indexOf('.')) refSpec += '.adoc'
        const attrs = node.getAttributes()
        const fragment = attrs.fragment
        if (fragment && fragment !== Opal.nil) refSpec += '#' + fragment
        const { content, target, internal, unresolved } = convertPageRef(
          refSpec,
          node.getText(),
          context.file,
          context.contentCatalog,
          context.config.relativizePageRefs !== false
        )
        let type
        if (internal) {
          type = 'xref'
          delete attrs.path
          delete attrs.fragment
          attrs.refid = fragment // or target.substr(1)
        } else {
          type = 'link'
          attrs.role = `page${unresolved ? ' unresolved' : ''}${attrs.role ? ' ' + attrs.role : ''}`
        }
        const attributes = Opal.hash2(Object.keys(attrs), attrs)
        const options = Opal.hash2(['type', 'target', 'attributes'], { type, target, attributes })
        node = Opal.module(null, 'Asciidoctor').Inline.$new(node.getParent(), 'anchor', content, options)
      }
    }
    return Opal.send(this, Opal.find_super_dispatcher(this, 'inline_anchor', convertInlineAnchor), [node])
  })
  Opal.defn(scope, '$image', function convertImage (node) {
    return Opal.send(this, Opal.find_super_dispatcher(this, 'image', convertImage), [
      transformImageNode(this, node, node.getAttribute('target'), this[$context]),
    ])
  })
  Opal.defn(scope, '$inline_image', function convertInlineImage (node) {
    return Opal.send(this, Opal.find_super_dispatcher(this, 'inline_image', convertInlineImage), [
      transformImageNode(this, node, node.getTarget(), this[$context]),
    ])
  })
  return scope
})()

function transformImageNode (converter, node, imageTarget, context) {
  if (matchesResourceSpec(imageTarget)) {
    if (context) {
      const alt = node.getAttribute('alt', undefined, false)
      if (node.isAttribute('default-alt', alt, false)) node.setAttribute('alt', alt.split(/[@:]/).pop())
      Opal.defs(
        node,
        '$image_uri',
        (imageSpec) => convertImageRef(imageSpec, context.file, context.contentCatalog) || imageSpec
      )
    }
  }
  if (node.hasAttribute('xref')) {
    const refSpec = node.getAttribute('xref', '', false)
    if (refSpec.charAt() === '#') {
      node.setAttribute('link', refSpec)
    } else if (refSpec.endsWith('.adoc')) {
      if (context) {
        const { target, unresolved } = convertPageRef(
          refSpec,
          '[image]',
          context.file,
          context.contentCatalog,
          context.config.relativizePageRefs !== false
        )
        const role = node.getAttribute('role', undefined, false)
        node.setAttribute('role', `link-page${unresolved ? ' link-unresolved' : ''}${role ? ' ' + role : ''}`)
        node.setAttribute('link', target)
      }
    } else {
      node.setAttribute('link', '#' + refSpec)
    }
  }
  return node
}

function matchesResourceSpec (target) {
  return ~target.indexOf(':')
    ? !(~target.indexOf('://') || (target.startsWith('data:') && ~target.indexOf(',')))
    : target.indexOf('@') > 0
}

module.exports = Html5Converter

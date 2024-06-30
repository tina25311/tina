'use strict'

function load (DOMParser = require('@xmldom/xmldom').DOMParser) {
  if (DOMParser.__loaded) return DOMParser
  const referenceDoc = new DOMParser().parseFromString('<html/>', 'text/html')
  const qsa = typeof referenceDoc.querySelector !== 'function' && require('query-selector').default
  const serializer =
    !('outerHTML' in referenceDoc.documentElement) &&
    ('XMLSerializer' in globalThis && `${referenceDoc}` !== '<html/>' ? new globalThis.XMLSerializer() : true)
  if (!(qsa || serializer)) return Object.defineProperty(DOMParser, '__loaded', { value: true })
  const HTML_NAMESPACE_URI = 'http://www.w3.org/1999/xhtml'
  const DocumentClass = Object.getPrototypeOf(referenceDoc)
  const DocumentFragmentClass = Object.getPrototypeOf(referenceDoc.createDocumentFragment())
  const ElementClass = Object.getPrototypeOf(referenceDoc.documentElement)
  for (const class_ of [DocumentClass, DocumentFragmentClass, ElementClass]) {
    if (qsa) {
      class_.querySelector = function querySelector (selector) {
        return qsa(selector, this)[0]
      }
      class_.querySelectorAll = function querySelectorAll (selector) {
        return qsa(selector, this)
      }
      if (class_ === ElementClass) {
        class_.matches = function matches (selector) {
          return qsa.matches(selector, [this]).length === 1
        }
      }
    }
    if (class_ === ElementClass && serializer) {
      Object.defineProperty(class_, 'outerHTML', {
        get () {
          const el = this.namespaceURI === HTML_NAMESPACE_URI ? this.cloneNode(true) : this
          if (el !== this) {
            el.namespaceURI = null
            el.querySelectorAll('*').forEach((it) => it.namespaceURI === HTML_NAMESPACE_URI && (it.namespaceURI = null))
          }
          return serializer === true ? el.toString() : serializer.serializeToString(el)
        },
      })
      Object.defineProperty(class_, 'innerHTML', {
        get () {
          if (!this.hasChildNodes()) return ''
          const html = this.outerHTML
          return html.slice(html.indexOf('>') + 1, html.lastIndexOf('</'))
        },
      })
    }
  }
  return Object.defineProperty(DOMParser, '__loaded', { value: true })
}

module.exports = { load }

'use strict'

const Opal = global.Opal
const computeRelativeUrlPath = require('../util/compute-relative-url-path')

function convertImageRef (resourceSpec, node, currentPage, contentCatalog) {
  try {
    const resolved = contentCatalog.resolveResource(resourceSpec, currentPage.src, 'image', ['image'])
    if (resolved) {
      if (node.document.getAttributes()['data-uri']) {
        const extname = resolved.src.extname.slice(1)
        const mimetype = extname === 'svg' ? 'image/svg+xml' : `image/${extname}`
        const data = Opal.const_get_qualified('::', 'Base64').$strict_encode64(resolved.contents)
        return `data:${mimetype};base64,${data}`
      } else {
        return computeRelativeUrlPath(currentPage.pub.url, resolved.pub.url)
      }
    }
  } catch (e) {} // TODO enforce valid ID spec
}

module.exports = convertImageRef

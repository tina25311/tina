'use strict'

function readImage (resourceSpec, currentPage, contentCatalog) {
  try {
    const resolved = contentCatalog.resolveResource(resourceSpec, currentPage.src, 'image', ['image'])
    if (resolved) return resolved.contents.toString()
  } catch (e) {} // TODO enforce valid ID spec
}

module.exports = readImage

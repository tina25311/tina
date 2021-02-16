'use strict'

const { computeRelativeUrlPath } = require('@antora/util')

function convertImageRef (resourceSpec, currentPage, contentCatalog) {
  const image = contentCatalog.resolveResource(resourceSpec, currentPage.src, 'image', ['image'])
  if (image) return computeRelativeUrlPath(currentPage.pub.url, image.pub.url)
}

module.exports = convertImageRef

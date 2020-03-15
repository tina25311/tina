'use strict'

const computeRelativeUrlPath = require('../util/compute-relative-url-path')

/**
 * Converts the specified page reference to the data necessary to build an HTML link.
 *
 * Parses the page reference (page ID and optional fragment), resolves the corresponding file from
 * the content catalog, then grabs its publication (root-relative) path. If the relativize param is
 * true, transforms the root-relative path to a relative path from the current page to the target
 * page. Uses the resulting path to create the href for an HTML link that points to the published
 * target page.
 *
 * @memberof asciidoc-loader
 *
 * @param {String} refSpec - The target of an xref macro to a page, which is a page ID spec without
 * the .adoc extension and with an optional fragment identifier.
 * @param {String} content - The content (i.e., formatted text) of the link (undefined if not specified).
 * @param {File} currentPage - The virtual file for the current page.
 * @param {ContentCatalog} contentCatalog - The content catalog that contains the virtual files in the site.
 * @param {Boolean} [relativize=true] - Compute the target relative to the current page.
 * @returns {Object} A map ({ content, target, internal, unresolved }) containing the resolved
 * content and target to make an HTML link, and hints to indicate if the reference is either
 * internal or unresolved.
 */
function convertPageRef (refSpec, content, currentPage, contentCatalog, relativize = true) {
  let hash = ''
  let hashIdx
  let pageIdSpec = refSpec
  if (~(hashIdx = refSpec.indexOf('#'))) {
    hash = refSpec.substr(hashIdx)
    pageIdSpec = refSpec.substr(0, hashIdx)
  }
  let target
  let targetPage
  try {
    if (!((targetPage = contentCatalog.resolvePage(pageIdSpec, currentPage.src)) && targetPage.pub)) {
      // TODO log "Unresolved page ID"
      target = `#${pageIdSpec}.adoc${hash}`
      return { content: content || target.substr(1), target, unresolved: true }
    }
  } catch (e) {
    // TODO log "Invalid page ID syntax" (or e.message)
    target = `#${refSpec}`
    return { content: content || target.substr(1), target, unresolved: true }
  }
  if (relativize) {
    target = computeRelativeUrlPath(currentPage.pub.url, targetPage.pub.url, hash)
    if (target === hash) return { content, target, internal: true }
  } else {
    target = targetPage.pub.url + hash
  }
  if (!content) {
    if (hash) {
      content = `${pageIdSpec}.adoc${hash}`
    } else {
      content =
        (currentPage.src.family === 'nav'
          ? (targetPage.asciidoc || {}).navtitle
          : (targetPage.asciidoc || {}).xreftext) || `${pageIdSpec}.adoc`
    }
  }
  return { content, target }
}

module.exports = convertPageRef

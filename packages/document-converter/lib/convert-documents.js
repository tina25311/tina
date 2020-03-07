'use strict'

const convertDocument = require('./convert-document')
const loadAsciiDoc = require('@antora/asciidoc-loader')

const COMMA_DELIMITER_RX = /\s*,\s*/

/**
 * Converts the contents of AsciiDoc files in the content catalog to embeddable HTML.
 *
 * Finds all AsciiDoc files in the page family in the content catalog and converts the contents of
 * those files to embeddable HTML by delegating to the convertDocument function. The function then
 * returns all the files in the page family.  All the files returned from this function are expected
 * be composed (i.e., wrapped in an HTML layout) by the page composer.
 *
 * @memberof document-converter
 *
 * @param {ContentCatalog} contentCatalog - The catalog of all virtual content files in the site.
 * @param {Object} [siteAsciiDocConfig={}] - Site-wide AsciiDoc processor configuration options.
 *
 * @returns {Array<File>} The virtual files in the page family taken from the content catalog.
 */
function convertDocuments (contentCatalog, siteAsciiDocConfig = {}) {
  const mainAsciiDocConfigs = new Map()
  contentCatalog.getComponents().forEach(({ name: component, versions }) => {
    versions.forEach(({ version, asciidoc }) => {
      mainAsciiDocConfigs.set(buildCacheKey({ component, version }), asciidoc)
    })
  })
  const headerAsciiDocConfigs = new Map()
  const headerOverrides = { extensions: [], headerOnly: true }
  for (const [cacheKey, mainAsciiDocConfig] of mainAsciiDocConfigs) {
    headerAsciiDocConfigs.set(cacheKey, Object.assign({}, mainAsciiDocConfig, headerOverrides))
  }
  return contentCatalog
    .getPages()
    .filter((page) => page.out)
    .map((page) => {
      if (page.mediaType === 'text/asciidoc') {
        const doc = loadAsciiDoc(
          page,
          contentCatalog,
          headerAsciiDocConfigs.get(buildCacheKey(page.src)) || siteAsciiDocConfig
        )
        const attributes = doc.getAttributes()
        page.asciidoc = doc.hasHeader() ? { attributes, doctitle: doc.getDocumentTitle() } : { attributes }
        registerPageAliases(attributes['page-aliases'], page, contentCatalog)
        if ('page-partial' in attributes) page.src.contents = page.contents
      }
      return page
    })
    .map((page) =>
      page.asciidoc
        ? convertDocument(page, contentCatalog, mainAsciiDocConfigs.get(buildCacheKey(page.src)) || siteAsciiDocConfig)
        : page
    )
    .map((page) => delete page.src.contents && page)
}

function buildCacheKey ({ component, version }) {
  return `${version}@${component}`
}

function registerPageAliases (aliases, targetFile, contentCatalog) {
  if (!aliases) return
  return aliases
    .split(COMMA_DELIMITER_RX)
    .forEach((aliasSpec) => aliasSpec && contentCatalog.registerPageAlias(aliasSpec, targetFile))
}

module.exports = convertDocuments
module.exports.convertDocument = convertDocument

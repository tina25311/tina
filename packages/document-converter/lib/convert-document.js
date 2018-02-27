'use strict'

const loadAsciiDoc = require('@antora/asciidoc-loader')

/**
 * Converts the contents on the specified file from AsciiDoc to embeddable HTML.
 *
 * Delegates to the AsciiDoc Loader to load the AsciiDoc contents on the
 * specified virtual file to a Document object. It then graps the document
 * attributes from that Document and assigns them to the asciidoc.attributes
 * property on the file.  It then converts the Document to embeddable HTML,
 * wraps it in a Buffer, and assigns it to the contents property on the file.
 * If the document has a document title, that value is assigned to the
 * asciidoc.doctitle property on the file. Finally, the mediaType property is
 * updated to 'text/html'.
 *
 * @memberof document-converter
 *
 * @param {File} file - The virtual file whose contents is an AsciiDoc source document.
 * @param {ContentCatalog} [contentCatalog=undefined] - The catalog of all virtual content files in the site.
 * @param {Object} [asciidocConfig={}] - AsciiDoc processor configuration options.
 *
 * @returns {File} The virtual file that was converted.
 */
function convertDocument (file, contentCatalog = undefined, asciidocConfig = {}) {
  const doc = loadAsciiDoc(file, contentCatalog, asciidocConfig)
  const attributes = doc.getAttributes()
  // Q: should we backup the AsciiDoc contents for all pages? what's the impact?
  if ('page-partial' in attributes) file.src.contents = file.contents
  file.asciidoc = doc.hasHeader() ? { attributes, doctitle: doc.getDocumentTitle() } : { attributes }
  file.contents = Buffer.from(doc.convert())
  file.mediaType = 'text/html'
  return file
}

module.exports = convertDocument

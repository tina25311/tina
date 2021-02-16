'use strict'

/**
 * Utility component for Antora
 *
 * Includes functionality used by several packages critical to the structure of Antora.
 *
 * @namespace utility
 */
module.exports = {
  computeRelativeUrlPath: require('./compute-relative-url-path'),
  requireLibrary: require('./require-library'),
  versionCompare: require('./version-compare-desc'),
}

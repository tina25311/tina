'use strict'

module.exports = Object.freeze({
  UI_CACHE_FOLDER: 'ui',
  UI_DESC_FILENAME: 'ui.yml',
  UI_SRC_GLOB: '**/*[!~]',
  UI_SRC_OPTS: { follow: true, nomount: true, nosort: true, nounique: true, removeBOM: false, uniqueBy: (m) => m },
})

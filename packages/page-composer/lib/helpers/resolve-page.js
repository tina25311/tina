'use strict'

module.exports = (spec, { data, hash: context }) => spec && data.root.site.contentCatalog.resolvePage(spec, context)

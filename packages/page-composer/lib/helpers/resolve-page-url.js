'use strict'

module.exports = (spec, { data, hash: context }) => {
  const page = spec && data.root.site.contentCatalog.resolvePage(spec, context)
  if (page) return page.pub.url
}

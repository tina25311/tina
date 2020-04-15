'use strict'

const { buildPageUiModel } = require('./../build-ui-model')

module.exports = (spec, { data, hash: context }) => {
  if (!spec) return
  const { contentCatalog, site } = data.root
  const page = contentCatalog.resolvePage(spec, context)
  if (page) {
    return 'model' in context && (context.model ? !delete context.model : delete context.model)
      ? page
      : buildPageUiModel(site, page, contentCatalog)
  }
}

'use strict'

const GeneratorContext = require('@antora/site-generator/generator-context')

async function generateSite (playbook) {
  const context = new GeneratorContext(module)
  try {
    const { fxns } = await GeneratorContext.start(context, playbook)
    const contentAggregate = await fxns.aggregateContent(playbook)
    const contentCatalog = fxns.classifyContent(playbook, contentAggregate)
    const reportPage = createReportPage(contentCatalog)
    const siteCatalog = { getFiles: () => [reportPage] }
    return fxns.publishSite(playbook, [siteCatalog])
  } finally {
    await GeneratorContext.close(context)
  }
}

function createReportPage (contentCatalog) {
  return {
    title: 'Pages Report',
    contents: Buffer.from(`<html><h1>Pages Report</h1><p>Pages: ${contentCatalog.getPages().length}</p></html>`),
    mediaType: 'text/html',
    src: { stem: 'index' },
    out: { path: 'index.html' },
    pub: { url: '/index.html', rootPath: '' },
  }
}

module.exports = generateSite

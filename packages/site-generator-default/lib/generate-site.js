'use strict'

const GeneratorContext = require('./generator-context')
const SiteCatalog = require('./site-catalog')

async function generateSite (playbook) {
  try {
    const context = new GeneratorContext(playbook, module)
    const { fxns, vars } = context
    await context.notify('playbookBuilt')
    playbook = vars.lock('playbook')
    vars.asciidocConfig = fxns.resolveAsciiDocConfig(playbook)
    vars.siteCatalog = new SiteCatalog()
    await context.notify('beforeProcess')
    const asciidocConfig = vars.lock('asciidocConfig')
    await Promise.all([
      fxns.aggregateContent(playbook).then((contentAggregate) =>
        context.notify('contentAggregated', Object.assign(vars, { contentAggregate })).then(() => {
          vars.contentCatalog = fxns.classifyContent(playbook, vars.remove('contentAggregate'), asciidocConfig)
        })
      ),
      fxns.loadUi(playbook).then((uiCatalog) => context.notify('uiLoaded', Object.assign(vars, { uiCatalog }))),
    ])
    await context.notify('contentClassified')
    const contentCatalog = vars.lock('contentCatalog')
    const uiCatalog = vars.lock('uiCatalog')
    fxns.convertDocuments(contentCatalog, asciidocConfig)
    await context.notify('documentsConverted')
    vars.navigationCatalog = fxns.buildNavigation(contentCatalog, asciidocConfig)
    await context.notify('navigationBuilt')
    ;(() => {
      const navigationCatalog = vars.remove('navigationCatalog')
      const composePage = fxns.createPageComposer(playbook, contentCatalog, uiCatalog, playbook.env)
      contentCatalog.getPages((page) => page.out && composePage(page, contentCatalog, navigationCatalog))
      if (playbook.site.url) vars.siteCatalog.addFile(composePage(create404Page()))
    })()
    await context.notify('pagesComposed')
    vars.siteCatalog.addFiles(fxns.produceRedirects(playbook, contentCatalog))
    await context.notify('redirectsProduced')
    if (playbook.site.url) {
      const publishablePages = contentCatalog.getPages((page) => page.out)
      vars.siteCatalog.addFiles(fxns.mapSite(playbook, publishablePages))
      await context.notify('siteMapped')
    }
    await context.notify('beforePublish')
    return fxns.publishSite(playbook, [contentCatalog, uiCatalog, vars.lock('siteCatalog')]).then((publications) => {
      if (!playbook.runtime.quiet && process.stdout.isTTY) {
        process.stdout.write('Site generation complete!\n')
        publications.forEach(
          ({ fileUri }) => fileUri && process.stdout.write(`View the site by visiting ${fileUri} in a browser.\n`)
        )
      }
      return context
        .notify('sitePublished', Object.assign(vars, { publications }))
        .then(() => vars.remove('publications'))
    })
  } catch (err) {
    if (!GeneratorContext.isHaltSignal(err)) throw err
  }
}

function create404Page () {
  return {
    title: 'Page Not Found',
    mediaType: 'text/html',
    src: { stem: '404' },
    out: { path: '404.html' },
    pub: { url: '/404.html', rootPath: '' },
  }
}

module.exports = generateSite

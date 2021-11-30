'use strict'

const GeneratorContext = require('./generator-context')
const SiteCatalog = require('./site-catalog')

async function generateSite (playbook) {
  const context = new GeneratorContext(module)
  try {
    const { fxns, vars } = await GeneratorContext.start(context, playbook)
    await context.notify('playbookBuilt')
    playbook = context.lockVariable('playbook')
    vars.siteAsciiDocConfig = fxns.resolveAsciiDocConfig(playbook)
    vars.siteCatalog = new SiteCatalog()
    await context.notify('beforeProcess')
    const siteAsciiDocConfig = context.lockVariable('siteAsciiDocConfig')
    await Promise.all([
      fxns.aggregateContent(playbook).then((contentAggregate) =>
        context.notify('contentAggregated', Object.assign(vars, { contentAggregate })).then(() => {
          contentAggregate = context.removeVariable('contentAggregate')
          vars.contentCatalog = fxns.classifyContent(playbook, contentAggregate, siteAsciiDocConfig)
        })
      ),
      fxns.loadUi(playbook).then((uiCatalog) => context.notify('uiLoaded', Object.assign(vars, { uiCatalog }))),
    ])
    await context.notify('contentClassified')
    const contentCatalog = context.lockVariable('contentCatalog')
    const uiCatalog = context.lockVariable('uiCatalog')
    fxns.convertDocuments(contentCatalog, siteAsciiDocConfig)
    await context.notify('documentsConverted')
    vars.navigationCatalog = fxns.buildNavigation(contentCatalog, siteAsciiDocConfig)
    await context.notify('navigationBuilt')
    ;((composePage) => {
      const navigationCatalog = context.removeVariable('navigationCatalog')
      contentCatalog.getPages((page) => page.out && composePage(page, contentCatalog, navigationCatalog))
      if (playbook.site.url) vars.siteCatalog.addFile(composePage(create404Page()))
    })(fxns.createPageComposer(playbook, contentCatalog, uiCatalog, playbook.env))
    await context.notify('pagesComposed')
    vars.siteCatalog.addFiles(fxns.produceRedirects(playbook, contentCatalog))
    await context.notify('redirectsProduced')
    if (playbook.site.url) {
      const publishablePages = contentCatalog.getPages((page) => page.out)
      vars.siteCatalog.addFiles(fxns.mapSite(playbook, publishablePages))
      await context.notify('siteMapped')
    }
    await context.notify('beforePublish')
    const siteCatalog = context.lockVariable('siteCatalog')
    return fxns.publishFiles(playbook, [contentCatalog, uiCatalog, siteCatalog]).then((publications) => {
      if (!playbook.runtime.quiet && process.stdout.isTTY) {
        const indexPath = contentCatalog.getSiteStartPage() ? '/index.html' : ''
        const log = (msg) => process.stdout.write(msg + '\n')
        log('Site generation complete!')
        publications.forEach(
          ({ fileUri }) => fileUri && log(`Open ${fileUri}${indexPath} in a browser to view your site.`)
        )
      }
      return context
        .notify('sitePublished', Object.assign(vars, { publications }))
        .then(() => context.removeVariable('publications'))
    })
  } catch (err) {
    if (!GeneratorContext.isStopSignal(err)) throw err
    await err.notify()
  } finally {
    await GeneratorContext.close(context)
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

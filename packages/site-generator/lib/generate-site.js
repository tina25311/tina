'use strict'

const GeneratorContext = require('./generator-context')
const SiteCatalog = require('./site-catalog')

async function generateSite (playbook) {
  const context = new GeneratorContext(module)
  try {
    if (Array.isArray(playbook)) playbook = buildPlaybookFromArguments.apply(context, arguments) // not using CLI
    const { fxns, vars } = await GeneratorContext.start(context, playbook)
    await context.notify('playbookBuilt')
    let url = (playbook = vars.lock('playbook')).site.url
    if (url && url.length > 1 && url.charAt(url.length - 1) === '/') playbook.site.url = url = url.slice(0, -1)
    await context.notify('beforeProcess', {
      siteAsciiDocConfig: fxns.resolveAsciiDocConfig(deepFreeze(playbook)),
      siteCatalog: new SiteCatalog(),
    })
    const siteAsciiDocConfig = vars.lock('siteAsciiDocConfig')
    const loadUiHandler = {
      onFulfilled: (uiCatalog) => context.notify('uiLoaded', { uiCatalog }),
      onRejected: (loadUiErr) => {
        if (!(loadUiHandler.retry = loadUiErr.recoverable)) throw loadUiErr
      },
    }
    await Promise.all([
      fxns.aggregateContent(playbook).then((contentAggregate) =>
        context
          .notify('contentAggregated', { contentAggregate })
          .then(() =>
            fxns.classifyContent(playbook, vars.remove('contentAggregate'), siteAsciiDocConfig, (contentCatalog) =>
              context.notify('componentsRegistered', { contentCatalog }).then(() => vars.remove('contentCatalog'))
            )
          )
          .then((contentCatalog) => (vars.contentCatalog = contentCatalog))
      ),
      fxns.loadUi(playbook).then(loadUiHandler.onFulfilled, loadUiHandler.onRejected),
    ])
    if (loadUiHandler.retry) await fxns.loadUi(playbook).then(loadUiHandler.onFulfilled)
    await context.notify('contentClassified')
    const contentCatalog = vars.lock('contentCatalog')
    const uiCatalog = vars.lock('uiCatalog')
    fxns.convertDocuments(contentCatalog, siteAsciiDocConfig)
    await context.notify('documentsConverted')
    vars.navigationCatalog = fxns.buildNavigation(contentCatalog, siteAsciiDocConfig)
    await context.notify('navigationBuilt')
    ;(({ composePage, create404Page }) => {
      const navigationCatalog = vars.remove('navigationCatalog')
      contentCatalog.getPages((page) => page.out && composePage(page, contentCatalog, navigationCatalog))
      if (url) vars.siteCatalog.addFile(create404Page(siteAsciiDocConfig))
    })(fxns.createPageComposer(playbook, contentCatalog, uiCatalog, playbook.env))
    await context.notify('pagesComposed')
    vars.siteCatalog.addFiles(fxns.produceRedirects(playbook, contentCatalog.findBy({ family: 'alias' })))
    await context.notify('redirectsProduced')
    if (url) {
      const publishablePages = contentCatalog.getPages((page) => page.out)
      vars.siteCatalog.addFiles(fxns.mapSite(playbook, publishablePages))
      await context.notify('siteMapped')
    }
    await context.notify('beforePublish')
    return await fxns
      .publishFiles(playbook, [contentCatalog, uiCatalog, vars.lock('siteCatalog')])
      .then((publications) => {
        if (!playbook.runtime.quiet && (playbook.env.IS_TTY || String(process.stdout.isTTY)) === 'true') {
          const indexPath = contentCatalog.getSiteStartPage() ? '/index.html' : ''
          const log = (msg) => process.stdout.write(msg + '\n')
          const isCI = playbook.env.CI === 'true'
          log('Site generation complete!')
          publications.forEach((pub) => {
            const baseUri = isCI ? url : pub?.fileUri
            if (baseUri) log(`Open ${baseUri}${indexPath} in a browser to view your site.`)
          })
        }
        return context.notify('sitePublished', { publications }).then(() => vars.remove('publications'))
      })
  } catch (err) {
    if (!GeneratorContext.isStopSignal(err)) throw err
    await err.notify()
  } finally {
    await GeneratorContext.close(context)
  }
}

function buildPlaybookFromArguments (args, env) {
  return require('@antora/playbook-builder')(args, env, undefined, (config) => {
    try {
      const { configureLogger, finalizeLogger } = require('@antora/logger')
      const playbookFile = config.get('playbook') || process.cwd() + '/.'
      configureLogger(config.getModel('runtime.log'), require('node:path').dirname(playbookFile))
      this.on('contextClosed', finalizeLogger)
    } catch {}
  })
}

function deepFreeze (o, p = '') {
  for (const [k, v] of Object.entries(o)) Object.isFrozen(v) || (k === 'env' && !p) || deepFreeze(v, p + k + '.')
  return Object.freeze(o)
}

module.exports = generateSite

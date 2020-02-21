'use strict'

module.exports.register = (eventEmitter) => {

  const eventContext = {}

  eventEmitter.on('beforeBuildPlaybook', ({args, env, schema}) => {
    //should not be called; only plugins supplied by the site generator can receive this event.
    eventContext.beforeBuildPlaybook = 'called'
  })
  eventEmitter.on('afterBuildPlaybook', (playbook) => {
    eventContext.afterBuildPlaybook = {playbook}
  })

  eventEmitter.on('beforeResolveAsciiDocConfig', ({playbook}) => {
    eventContext.beforeResolveAsciiDocConfig = {playbook}
  })
  eventEmitter.on('afterResolveAsciiDocConfig', (playbook, asciidocConfig) => {
    eventContext.afterResolveAsciiDocConfig = {asciidocConfig}
  })

  eventEmitter.on('beforeAggregateContent', ({playbook}) => {
    eventContext.beforeAggregateContent = {playbook}
  })
  eventEmitter.on('onComponentDescriptor',
    ({ componentDescriptor, files, startPath, repo, authStatus, ref, worktreePath, origin }) => {
      eventContext.onComponentDescriptor = { componentDescriptor, files, startPath, repo, authStatus, ref, worktreePath, origin }
    }
  )
  eventEmitter.on('afterAggregateContent', async (playbook, contentAggregate) => {
    eventContext.afterAggregateContent = {contentAggregate}
  })

  eventEmitter.on('beforeClassifyContent', async ({playbook, contentAggregate, asciidocConfig}) => {
    eventContext.beforeClassifyContent = {playbook, contentAggregate, asciidocConfig}
  })
  eventEmitter.on('afterClassifyContent', (playbook, contentCatalog) => {
    eventContext.afterClassifyContent = {contentCatalog}
  })

  eventEmitter.on('beforeLoadUi', ({playbook}) => {
    eventContext.beforeLoadUi = {playbook}
  })
  eventEmitter.on('afterLoadUi', (playbook, uiCatalog) => {
    eventContext.afterLoadUi = {uiCatalog}
  })

  eventEmitter.on('beforeConvertDocuments', ({contentCatalog, asciidocConfig, playbook}) => {
    eventContext.beforeConvertDocuments = {contentCatalog, asciidocConfig, playbook}
  })
  eventEmitter.on('onDocumentHeadersParsed',
    ({ pagesWithHeaders, contentCatalog }) => {
      eventContext.onDocumentHeadersParsed = { pagesWithHeaders, contentCatalog }
    }
  )
  eventEmitter.on('afterConvertDocuments', (playbook, pages) => {
    eventContext.afterConvertDocuments = {pages}
  })

  eventEmitter.on('beforeBuildNavigation', ({contentCatalog, asciidocConfig, playbook}) => {
    eventContext.beforeBuildNavigation = {contentCatalog, asciidocConfig, playbook}
  })
  eventEmitter.on('afterBuildNavigation', (navigationCatalog ) => {
    eventContext.afterBuildNavigation = {navigationCatalog}
  })

  eventEmitter.on('beforeCreatePageComposer', ({playbook, contentCatalog, uiCatalog, env}) => {
    eventContext.beforeCreatePageComposer = {playbook, contentCatalog, uiCatalog, env}
  })
  eventEmitter.on('afterCreatePageComposer', (playbook, composePage) => {
    eventContext.afterCreatePageComposer = {composePage}
  })

  eventEmitter.on('beforeComposePage', ({page, contentCatalog, navigationCatalog, playbook}) => {
    eventContext.beforeComposePage = {page, contentCatalog, navigationCatalog, playbook}
  })
  eventEmitter.on('afterComposePage', (playbook, page) => {
    eventContext.afterComposePage = {page}
  })

  eventEmitter.on('beforeMapSite', ({playbook, pages}) => {
    eventContext.beforeMapSite = {playbook, pages}
  })
  eventEmitter.on('afterMapSite', (playbook, siteFiles) => {
    eventContext.afterMapSite = {siteFiles}
  })

  eventEmitter.on('beforeProduceRedirects', ({playbook, contentCatalog}) => {
    eventContext.beforeProduceRedirects = {playbook, contentCatalog}
  })
  eventEmitter.on('afterProduceRedirects', (playbook, siteFiles) => {
    eventContext.afterProduceRedirects = {siteFiles}
  })

  eventEmitter.on('beforePublishSite', ({playbook, catalogs}) => {
    eventContext.beforePublishSite = {playbook, catalogs}
  })
  eventEmitter.on('afterPublishSite', (playbook, reports) => {
    eventContext.afterPublishSite = {reports}
    reports.push(eventContext)
  })

}


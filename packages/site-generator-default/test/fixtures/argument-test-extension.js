'use strict'

module.exports.register = (eventEmitter) => {

  const eventContext = {}

  eventEmitter.on('beforeBuildPlaybook', ({args, env, schema}) => {
    //should not be called; only plugins supplied by the site generator can receive this event.
    eventContext.beforeBuildPlaybook = 'called'
  })
  eventEmitter.on('afterBuildPlaybook', (playbook) => {
    eventContext.afterBuildPlaybook = { playbook }
  })

  eventEmitter.on('beforeResolveAsciiDocConfig', ({ context }) => {
    eventContext.beforeResolveAsciiDocConfig = { context }
  })
  eventEmitter.on('afterResolveAsciiDocConfig', (context, asciidocConfig) => {
    eventContext.afterResolveAsciiDocConfig = {asciidocConfig}
  })

  eventEmitter.on('beforeAggregateContent', ({ context }) => {
    eventContext.beforeAggregateContent = { context }
  })
  eventEmitter.on('onComponentDescriptor',
    ({ componentDescriptor, files, startPath, repo, authStatus, ref, worktreePath, origin }) => {
      eventContext.onComponentDescriptor = { componentDescriptor, files, startPath, repo, authStatus, ref, worktreePath, origin }
    }
  )
  eventEmitter.on('afterAggregateContent', async (context, contentAggregate) => {
    eventContext.afterAggregateContent = {contentAggregate}
  })

  eventEmitter.on('beforeClassifyContent', async ({context, contentAggregate, asciidocConfig}) => {
    eventContext.beforeClassifyContent = {context, contentAggregate, asciidocConfig}
  })
  eventEmitter.on('afterClassifyContent', (context, contentCatalog) => {
    eventContext.afterClassifyContent = {contentCatalog}
  })

  eventEmitter.on('beforeLoadUi', ({context}) => {
    eventContext.beforeLoadUi = {context}
  })
  eventEmitter.on('afterLoadUi', (context, uiCatalog) => {
    eventContext.afterLoadUi = {uiCatalog}
  })

  eventEmitter.on('beforeConvertDocuments', ({contentCatalog, asciidocConfig, context}) => {
    eventContext.beforeConvertDocuments = {contentCatalog, asciidocConfig, context}
  })
  eventEmitter.on('onDocumentHeadersParsed',
    ({ pagesWithHeaders, contentCatalog }) => {
      eventContext.onDocumentHeadersParsed = { pagesWithHeaders, contentCatalog }
    }
  )
  eventEmitter.on('afterConvertDocuments', (context, pages) => {
    eventContext.afterConvertDocuments = {pages}
  })

  eventEmitter.on('beforeBuildNavigation', ({contentCatalog, asciidocConfig, context}) => {
    eventContext.beforeBuildNavigation = {contentCatalog, asciidocConfig, context}
  })
  eventEmitter.on('afterBuildNavigation', (context, navigationCatalog ) => {
    eventContext.afterBuildNavigation = {navigationCatalog}
  })

  eventEmitter.on('beforeCreatePageComposer', ({context, contentCatalog, uiCatalog, env}) => {
    eventContext.beforeCreatePageComposer = {context, contentCatalog, uiCatalog, env}
  })
  eventEmitter.on('afterCreatePageComposer', (context, composePage) => {
    eventContext.afterCreatePageComposer = {composePage}
  })

  eventEmitter.on('beforeComposePage', ({page, contentCatalog, navigationCatalog, context}) => {
    eventContext.beforeComposePage = {page, contentCatalog, navigationCatalog, context}
  })
  eventEmitter.on('afterComposePage', (context, page) => {
    eventContext.afterComposePage = {page}
  })

  eventEmitter.on('beforeMapSite', ({context, pages}) => {
    eventContext.beforeMapSite = {context, pages}
  })
  eventEmitter.on('afterMapSite', (context, siteFiles) => {
    eventContext.afterMapSite = {siteFiles}
  })

  eventEmitter.on('beforeProduceRedirects', ({context, contentCatalog}) => {
    eventContext.beforeProduceRedirects = {context, contentCatalog}
  })
  eventEmitter.on('afterProduceRedirects', (context, siteFiles) => {
    eventContext.afterProduceRedirects = {siteFiles}
  })

  eventEmitter.on('beforePublishSite', ({context, catalogs}) => {
    eventContext.beforePublishSite = {context, catalogs}
  })
  eventEmitter.on('afterPublishSite', (context, reports) => {
    eventContext.afterPublishSite = {reports}
    reports.push(eventContext)
  })

}


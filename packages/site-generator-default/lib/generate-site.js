'use strict'

const EventEmitter = require('events')
const buildPlaybook = require('@antora/playbook-builder')
const { requireLibrary } = require('@antora/util')

//Map of stage name to default implementation.
//Playbook configuration can override the defaults.
const defaultStages = {
  asciidocLoader: '@antora/asciidoc-loader',
  contentAggregator: '@antora/content-aggregator',
  navigationBuilder: '@antora/navigation-builder',
  contentClassifier: '@antora/content-classifier',
  documentConverter: '@antora/document-converter',
  pageComposer: '@antora/page-composer',
  uiLoader: '@antora/ui-loader',
  siteMapper: '@antora/site-mapper',
  redirectProducer: '@antora/redirect-producer',
  sitePublisher: '@antora/site-publisher',
}

async function generateSite (args, env) {
  const baseEmitter = new EventEmitter()

  const eventEmitter = {

    emit: async (name, ...args) => {
      const promises = []
      baseEmitter.emit(name, promises, ...args)
      promises.length && await Promise.all(promises)
    },

    on: (name, listener) => baseEmitter.on(name, (promises, ...args) => promises.push(listener(...args))),
  }
  const playbook = await buildPlaybook(args, env, undefined, eventEmitter)
  const context = constructContext(playbook, eventEmitter)
  const asciidocConfig = await wrapSync('ResolveAsciiDocConfig', context.asciidocLoader.resolveAsciiDocConfig)
  const [contentCatalog, uiCatalog] = await Promise.all([
    wrapAsync('AggregateContent', context.contentAggregator)
      .then((contentAggregate) => wrapSync('ClassifyContent', context.contentClassifier, {
        contentAggregate,
        asciidocConfig,
      })),
    wrapAsync('LoadUi', context.uiLoader),
  ])
  const pages = await wrapAsync('ConvertDocuments', context.documentConverter, { contentCatalog, asciidocConfig })
  const navigationCatalog = await wrapSync('BuildNavigation', context.navigationBuilder, { contentCatalog, asciidocConfig })
  const composePage = await wrapSync('CreatePageComposer', context.pageComposer, {
    contentCatalog,
    uiCatalog,
    env,
  })
  await Promise.all(pages.map((page) => wrapSync('ComposePage', composePage, { page, contentCatalog, navigationCatalog })))
  const siteFiles = (await wrapSync('MapSite', context.siteMapper, { pages }))
    .concat(await wrapSync('ProduceRedirects', context.redirectProducer, { contentCatalog }))
  if (playbook.site.url) siteFiles.push(composePage(create404Page()))
  const siteCatalog = { getFiles: () => siteFiles }
  return wrapAsync('PublishSite', context.sitePublisher, { catalogs: [contentCatalog, uiCatalog, siteCatalog] })

  async function wrapAsync (name, funct, argObject) {
    argObject || (argObject = {})
    argObject.context = context
    const args = Object.values(argObject)
    await eventEmitter.emit('before' + name, argObject)
    return funct(...args).then(async (result) => {
      await eventEmitter.emit('after' + name, context, result)
      return result
    })
  }

  async function wrapSync (name, funct, argObject) {
    argObject || (argObject = {})
    argObject.context = context
    const args = Object.values(argObject)
    await eventEmitter.emit('before' + name, argObject)
    const result = funct(...args)
    await eventEmitter.emit('after' + name, context, result)
    return result
  }
}

// Returns a frozen context object containing the event emitter, the playbook, and all pipeline stages.
function constructContext (playbook, eventEmitter) {
  const context = { playbook, eventEmitter }
  Object.entries(defaultStages).forEach(([stage, defaultImpl]) => {
    context[stage] = requireLibrary(playbook.pipelineStages[stage] || defaultImpl, playbook.dir)
  })
  Object.freeze(context)
  return context
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

'use strict'

const EventEmitter = require('events')
const aggregateContent = require('@antora/content-aggregator')
const buildNavigation = require('@antora/navigation-builder')
const buildPlaybook = require('@antora/playbook-builder')
const classifyContent = require('@antora/content-classifier')
const convertDocuments = require('@antora/document-converter')
const createPageComposer = require('@antora/page-composer')
const loadUi = require('@antora/ui-loader')
const mapSite = require('@antora/site-mapper')
const produceRedirects = require('@antora/redirect-producer')
const publishSite = require('@antora/site-publisher')
const { resolveAsciiDocConfig } = require('@antora/asciidoc-loader')

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
  const asciidocConfig = await wrapSync(eventEmitter, 'ResolveAsciiDocConfig', resolveAsciiDocConfig, playbook, { playbook })
  const [contentCatalog, uiCatalog] = await Promise.all([
    wrapAsync(eventEmitter, 'AggregateContent', aggregateContent, playbook, [playbook])
      .then((contentAggregate) => wrapSync(eventEmitter, 'ClassifyContent', classifyContent, playbook, { playbook, contentAggregate, asciidocConfig })),
    wrapAsync(eventEmitter, 'LoadUi', loadUi, playbook, [playbook]),
  ])
  const pages = await wrapAsync(eventEmitter, 'ConvertDocuments', convertDocuments, playbook, { contentCatalog, asciidocConfig })
  const navigationCatalog = await wrapSync(eventEmitter, 'BuildNavigation', buildNavigation, playbook, { contentCatalog, asciidocConfig })
  const composePage = await wrapSync(eventEmitter, 'CreatePageComposer', createPageComposer, playbook, { playbook, contentCatalog, uiCatalog, env })
  await Promise.all(pages.map((page) => wrapSync(eventEmitter, 'ComposePage', composePage, playbook, { page, contentCatalog, navigationCatalog })))
  const siteFiles = (await wrapSync(eventEmitter, 'MapSite', mapSite, playbook, { playbook, pages }))
    .concat(await wrapSync(eventEmitter, 'ProduceRedirects', produceRedirects, playbook, { playbook, contentCatalog }))
  if (playbook.site.url) siteFiles.push(composePage(create404Page()))
  const siteCatalog = { getFiles: () => siteFiles }
  return wrapAsync(eventEmitter, 'PublishSite', publishSite, playbook, { playbook, catalogs: [contentCatalog, uiCatalog, siteCatalog] })
}

async function wrapAsync (eventEmitter, name, funct, playbook, argObject) {
  const args = Object.values(argObject)
  'playbook' in argObject || (argObject.playbook = playbook)
  await eventEmitter.emit('before' + name, argObject)
  return funct(...args, eventEmitter).then(async (result) => {
    await eventEmitter.emit('after' + name, playbook, result)
    return result
  })
}

async function wrapSync (eventEmitter, name, funct, playbook, argObject) {
  const args = Object.values(argObject)
  'playbook' in argObject || (argObject.playbook = playbook)
  await eventEmitter.emit('before' + name, argObject)
  const result = funct(...args, eventEmitter)
  await eventEmitter.emit('after' + name, playbook, result)
  return result
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

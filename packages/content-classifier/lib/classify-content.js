'use strict'

const ContentCatalog = require('./content-catalog')
const collateAsciiDocAttributes = require('@antora/asciidoc-loader/config/collate-asciidoc-attributes')
const logger = require('./logger')
const summarizeFileLocation = require('./util/summarize-file-location')

/**
 * Organizes the raw aggregate of virtual files into a {ContentCatalog}.
 *
 * @memberof content-classifier
 *
 * @param {Object} playbook - The configuration object for Antora. See ContentCatalog constructor for relevant keys.
 * @param {Object} playbook.site - Site-related configuration data.
 * @param {String} playbook.site.startPage - The start page for the site; redirects from base URL.
 * @param {Object} aggregate - The raw aggregate of virtual file objects to be classified.
 * @param {Object} [siteAsciiDocConfig={}] - Site-wide AsciiDoc processor configuration options.
 * @param {Function} [onComponentsRegistered] - A function (optionally async) to invoke after components are
 *  registered. Must return an instance of ContentCatalog. If async, this function will also return a Promise.
 *
 * @returns {ContentCatalog} A structured catalog of content components, versions, and virtual content files.
 */
function classifyContent (playbook, aggregate, siteAsciiDocConfig = {}, onComponentsRegistered) {
  const siteStartPage = playbook.site.startPage
  let contentCatalog = registerComponentVersions(new ContentCatalog(playbook), aggregate, siteAsciiDocConfig)
  return typeof onComponentsRegistered === 'function' &&
    (contentCatalog = onComponentsRegistered(contentCatalog)) instanceof Promise
    ? contentCatalog.then((contentCatalogValue) => addFilesAndRegisterStartPages(contentCatalogValue, siteStartPage))
    : addFilesAndRegisterStartPages(contentCatalog, siteStartPage)
}

function registerComponentVersions (contentCatalog, aggregate, siteAsciiDocConfig) {
  for (const componentVersionBucket of aggregate) {
    // advance files, nav, and startPage to component version to be used in later phase
    const { name, version, files, nav, startPage, ...data } = Object.assign(componentVersionBucket, {
      asciidoc: resolveAsciiDocConfig(siteAsciiDocConfig, componentVersionBucket),
    })
    Object.assign(contentCatalog.registerComponentVersion(name, version, data), { files, nav, startPage })
  }
  return contentCatalog
}

function addFilesAndRegisterStartPages (contentCatalog, siteStartPage) {
  for (const { versions: componentVersions } of contentCatalog.getComponents()) {
    for (const componentVersion of componentVersions) {
      const { name: component, version, files = [], nav, startPage } = componentVersion
      const navResolved = nav && (nav.resolved = new Set())
      for (let file, i = 0, len = files.length; i < len; i++) {
        allocateSrc((file = files[i]), component, version, nav) && contentCatalog.addFile(file, componentVersion)
        files[i] = undefined // free memory
      }
      if (navResolved && nav.length > navResolved.size && new Set(nav).size > navResolved.size) {
        const loc = summarizeFileLocation({ path: 'antora.yml', src: { origin: nav.origin } })
        for (const filepath of nav) {
          if (navResolved.has(filepath)) continue
          logger.warn('Could not resolve nav entry for %s@%s defined in %s: %s', version, component, loc, filepath)
        }
      }
      contentCatalog.registerComponentVersionStartPage(component, componentVersion, startPage)
    }
  }
  contentCatalog.registerSiteStartPage(siteStartPage)
  return contentCatalog
}

function allocateSrc (file, component, version, nav) {
  const { extname, family } = file.src
  if (family && family !== 'nav') {
    Object.assign(file.src, { component, version })
    file.src.moduleRootPath ??= calculateRootPath(file.src.relative.split('/').length)
    return true
  }
  const filepath = file.path
  const pathSegments = filepath.split('/')
  let navInfo
  if (nav && (navInfo = getNavInfo(filepath, nav))) {
    if (extname !== '.adoc') return // ignore file
    file.nav = navInfo
    file.src.family = 'nav'
    if (pathSegments[0] === 'modules' && pathSegments.length > 2) {
      file.src.module = pathSegments[1]
      // relative to modules/<module>
      file.src.relative = pathSegments.slice(2).join('/')
      file.src.moduleRootPath = calculateRootPath(pathSegments.length - 3)
    } else {
      // relative to content source root
      file.src.relative = filepath
    }
  } else if (pathSegments[0] === 'modules') {
    let familyFolder = pathSegments[2]
    switch (familyFolder) {
      case 'pages':
        // pages/_partials location for partials is @deprecated; special designation scheduled for removal in Antora 4
        if (pathSegments[3] === '_partials') {
          file.src.family = 'partial'
          // relative to modules/<module>/pages/_partials
          file.src.relative = pathSegments.slice(4).join('/')
        } else if (extname === '.adoc') {
          file.src.family = 'page'
          // relative to modules/<module>/pages
          file.src.relative = pathSegments.slice(3).join('/')
        } else {
          return // ignore file
        }
        break
      case 'assets':
        switch ((familyFolder = pathSegments[3])) {
          case 'attachments':
          case 'images':
            if (!extname) return // ignore file
            file.src.family = familyFolder.substr(0, familyFolder.length - 1)
            // relative to modules/<module>/assets/<family>s
            file.src.relative = pathSegments.slice(4).join('/')
            break
          default:
            return // ignore file
        }
        break
      case 'attachments':
      case 'images':
        if (!extname) return
        file.src.family = familyFolder.substr(0, familyFolder.length - 1)
        // relative to modules/<module>/<family>s
        file.src.relative = pathSegments.slice(3).join('/')
        break
      case 'examples':
      case 'partials':
        file.src.family = familyFolder.substr(0, familyFolder.length - 1)
        // relative to modules/<module>/<family>s
        file.src.relative = pathSegments.slice(3).join('/')
        break
      default:
        return // ignore file
    }
    file.src.module = pathSegments[1]
    file.src.moduleRootPath = calculateRootPath(pathSegments.length - 3)
  } else {
    return // ignore file
  }
  file.src.component = component
  file.src.version = version
  return true
}

/**
 * Return navigation properties if this file is registered as a navigation file.
 *
 * @param {String} filepath - The path of the virtual file to match.
 * @param {Array} nav - The array of navigation entries from the component descriptor.
 *
 * @returns {Object} An object of properties, which includes the navigation
 * index, if this file is a navigation file, or undefined if it's not.
 */
function getNavInfo (filepath, nav) {
  const index = nav.findIndex((candidate) => candidate === filepath)
  if (~index) return nav.resolved.add(filepath) && { index }
}

function resolveAsciiDocConfig (siteAsciiDocConfig, { name, version, asciidoc, origins = [] }) {
  const scopedAttributes = (asciidoc || {}).attributes
  if (scopedAttributes) {
    const initial = Object.assign({}, siteAsciiDocConfig.attributes)
    initial['antora-component-name'] = name
    initial['antora-component-version'] = version
    const mdc = { file: { path: 'antora.yml', origin: origins[origins.length - 1] } }
    const attributes = collateAsciiDocAttributes(scopedAttributes, { initial, mdc, merge: true })
    if (attributes !== initial) {
      delete attributes['antora-component-name']
      delete attributes['antora-component-version']
      return Object.assign({}, siteAsciiDocConfig, { attributes })
    }
  }
  return siteAsciiDocConfig
}

function calculateRootPath (depth) {
  return depth ? Array(depth).fill('..').join('/') : '.'
}

module.exports = classifyContent

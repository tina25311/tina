'use strict'

const File = require('./file')
const parseResourceId = require('./util/parse-resource-id')
const { posix: path } = require('path')
const resolveResource = require('./util/resolve-resource')
const versionCompare = require('./util/version-compare-desc')

const { START_ALIAS_ID, START_PAGE_ID } = require('./constants')
const SPACE_RX = / /g

const $components = Symbol('components')
const $files = Symbol('files')

class ContentCatalog {
  constructor (playbook = {}) {
    this[$components] = new Map()
    this[$files] = new Map()
    const urls = playbook.urls || {}
    this.htmlUrlExtensionStyle = urls.htmlExtensionStyle || 'default'
    this.urlRedirectFacility = urls.redirectFacility || 'static'
    this.latestVersionUrlSegment = urls.latestVersionSegment
    this.latestPrereleaseVersionUrlSegment = urls.latestPrereleaseVersionSegment
    if (this.latestVersionUrlSegment == null && this.latestPrereleaseVersionUrlSegment == null) {
      this.latestVersionUrlSegmentStrategy = undefined
    } else {
      this.latestVersionUrlSegmentStrategy = urls.latestVersionSegmentStrategy || 'replace'
      if (this.latestVersionUrlSegmentStrategy === 'redirect:from') {
        if (!this.latestVersionUrlSegment) this.latestVersionUrlSegment = undefined
        if (!this.latestPrereleaseVersionUrlSegment) {
          this.latestPrereleaseVersionUrlSegment = undefined
          if (!this.latestVersionUrlSegment) this.latestVersionUrlSegmentStrategy = undefined
        }
      }
    }
  }

  /**
   * Registers a new component version with the content catalog. Also registers the component if it does not yet exist.
   *
   * @param {String} name - The name of the component to which this component version belongs.
   * @param {String} version - The version of the component to register.
   * @param {Object} [descriptor={}] - The configuration data for the component version.
   * @param {Object} [descriptor.asciidoc=undefined] - The AsciiDoc configuration for this component version.
   * @param {String} [descriptor.displayVersion=version] - The display version for this component version.
   * @param {Boolean|String} [descriptor.prerelease=undefined] - The prerelease flag for this version. If the value
   * is a String, it implies true and is appended to the display version, separated if necessary by a space.
   * @param {Boolean|String} [descriptor.startPage=undefined] - The page specifier for the start page. The start page
   * is only registered if this property is truthy. A String value will be used to resolve a start page within this
   * component version. A true value is a special case to tell this method to register the default start page and is
   * intended for testing.
   * @param {String} [descriptor.title=name] - The title for this component version.
   */
  registerComponentVersion (name, version, descriptor = {}) {
    const { asciidoc, displayVersion, prerelease, startPage: startPageSpec, title } = descriptor
    const componentVersion = { displayVersion: displayVersion || version, title: title || name, version }
    Object.defineProperty(componentVersion, 'name', { value: name, enumerable: true })
    if (prerelease) {
      componentVersion.prerelease = prerelease
      if (!displayVersion && (typeof prerelease === 'string' || prerelease instanceof String)) {
        const ch0 = prerelease.charAt()
        const sep = ch0 === '-' || ch0 === '.' ? '' : ' '
        componentVersion.displayVersion = `${version}${sep}${prerelease}`
      }
    }
    if (asciidoc) componentVersion.asciidoc = asciidoc
    const component = this[$components].get(name)
    if (component) {
      const componentVersions = component.versions
      const insertIdx = componentVersions.findIndex(({ version: candidate }) => {
        if (candidate === version) throw new Error(`Duplicate version detected for component ${name}: ${version}`)
        return versionCompare(candidate, version) > 0
      })
      if (~insertIdx) {
        componentVersions.splice(insertIdx, 0, componentVersion)
      } else {
        componentVersions.push(componentVersion)
      }
      component.latest = componentVersions.find((candidate) => !candidate.prerelease) || componentVersions[0]
    } else {
      this[$components].set(
        name,
        Object.defineProperties(
          { name, latest: componentVersion, versions: [componentVersion] },
          {
            asciidoc: {
              get () {
                return this.latest.asciidoc
              },
            },
            // NOTE deprecated; alias latestVersion to latest for backwards compatibility; remove in Antora 3
            latestVersion: {
              get () {
                return this.latest
              },
            },
            title: {
              get () {
                return this.latest.title
              },
            },
            url: {
              get () {
                return this.latest.url
              },
            },
          }
        )
      )
    }
    if (startPageSpec) {
      this.registerComponentVersionStartPage(name, componentVersion, startPageSpec === true ? undefined : startPageSpec)
    }
    return componentVersion
  }

  addFile (file) {
    const src = file.src
    let family = src.family
    const key = generateKey(src)
    if (this[$files].has(key)) {
      if (family === 'alias') {
        throw new Error(`Duplicate alias: ${generateResourceSpec(src)}`)
      } else {
        const details = [this.getById(src), file].map((it, idx) => `  ${idx + 1}: ${getFileLocation(it)}`).join('\n')
        if (family === 'nav') {
          throw new Error(`Duplicate nav in ${src.version}@${src.component}: ${file.path}\n${details}`)
        } else {
          throw new Error(`Duplicate ${family}: ${generateResourceSpec(src)}\n${details}`)
        }
      }
    }
    if (!File.isVinyl(file)) file = new File(file)
    if (family === 'alias') family = file.rel.src.family
    let publishable
    let versionSegment
    if (file.out) {
      publishable = true
    } else if ('out' in file) {
      delete file.out
    } else if (
      (family === 'page' || family === 'image' || family === 'attachment') &&
      !~('/' + src.relative).indexOf('/_')
    ) {
      publishable = true
      versionSegment = computeVersionSegment.bind(this)(src.component, src.version)
      file.out = computeOut(src, family, versionSegment, this.htmlUrlExtensionStyle)
    }
    if (!file.pub && (publishable || family === 'nav')) {
      if (versionSegment == null) versionSegment = computeVersionSegment.bind(this)(src.component, src.version)
      file.pub = computePub(src, file.out, family, versionSegment, this.htmlUrlExtensionStyle)
    }
    this[$files].set(key, file)
    return file
  }

  findBy (criteria) {
    const criteriaEntries = Object.entries(criteria)
    const accum = []
    for (const candidate of this[$files].values()) {
      const candidateSrc = candidate.src
      if (criteriaEntries.every(([key, val]) => candidateSrc[key] === val)) accum.push(candidate)
    }
    return accum
  }

  getById ({ component, version, module: module_, family, relative }) {
    return this[$files].get(generateKey({ component, version, module: module_, family, relative }))
  }

  getByPath ({ component, version, path: path_ }) {
    for (const candidate of this[$files].values()) {
      if (candidate.path === path_ && candidate.src.component === component && candidate.src.version === version) {
        return candidate
      }
    }
  }

  getComponent (name) {
    return this[$components].get(name)
  }

  getComponentVersion (component, version) {
    return (component.versions || (this.getComponent(component) || {}).versions || []).find(
      ({ version: candidate }) => candidate === version
    )
  }

  /**
   * @deprecated scheduled to be removed in Antora 3
   */
  getComponentMap () {
    const accum = {}
    for (const [name, component] of this[$components]) {
      accum[name] = component
    }
    return accum
  }

  /**
   * @deprecated scheduled to be removed in Antora 3
   */
  getComponentMapSortedBy (property) {
    const accum = {}
    for (const component of this.getComponentsSortedBy(property)) {
      accum[component.name] = component
    }
    return accum
  }

  getComponents () {
    return [...this[$components].values()]
  }

  getComponentsSortedBy (property) {
    return this.getComponents().sort((a, b) => a[property].localeCompare(b[property]))
  }

  getAll () {
    return [...this[$files].values()]
  }

  getPages (filter) {
    const accum = []
    if (filter) {
      for (const candidate of this[$files].values()) {
        if (candidate.src.family === 'page' && filter(candidate)) accum.push(candidate)
      }
    } else {
      for (const candidate of this[$files].values()) {
        if (candidate.src.family === 'page') accum.push(candidate)
      }
    }
    return accum
  }

  // TODO add `follow` argument to control whether alias is followed
  getSiteStartPage () {
    return this.getById(START_PAGE_ID) || (this.getById(START_ALIAS_ID) || {}).rel
  }

  registerComponentVersionStartPage (name, componentVersion, startPageSpec = undefined) {
    let version = componentVersion.version
    if (version == null) {
      // QUESTION: should we warn or throw error if component version cannot be found?
      if (!(componentVersion = this.getComponentVersion(name, componentVersion))) return
      version = componentVersion.version
    }
    let startPage
    let startPageSrc
    const indexPageId = { component: name, version, module: 'ROOT', family: 'page', relative: 'index.adoc' }
    if (startPageSpec) {
      if (
        (startPage = this.resolvePage(startPageSpec, indexPageId)) &&
        (startPageSrc = startPage.src).component === name &&
        startPageSrc.version === version
      ) {
        if ((startPageSrc.module !== 'ROOT' || startPageSrc.relative !== 'index.adoc') && !this.getById(indexPageId)) {
          this.addFile({ mediaType: 'text/html', src: inflateSrc(indexPageId, 'alias'), rel: startPage })
        }
      } else {
        console.warn(
          `Start page specified for ${version}@${name} ${startPage === false ? 'has invalid syntax' : 'not found'}: ` +
            startPageSpec
        )
        startPage = this.getById(indexPageId)
      }
    } else {
      startPage = this.getById(indexPageId)
    }
    if (startPage) {
      componentVersion.url = startPage.pub.url
    } else {
      // QUESTION: should we warn if the default start page cannot be found?
      const versionSegment = computeVersionSegment.bind(this)(name, version)
      componentVersion.url = computePub(
        (startPageSrc = inflateSrc(indexPageId)),
        computeOut(startPageSrc, startPageSrc.family, versionSegment, this.htmlUrlExtensionStyle),
        startPageSrc.family,
        versionSegment,
        this.htmlUrlExtensionStyle
      ).url
    }

    const symbolicVersionAlias = createSymbolicVersionAlias(
      name,
      version,
      computeVersionSegment.bind(this)(name, version, 'alias'),
      this.latestVersionUrlSegmentStrategy
    )
    if (symbolicVersionAlias) this.addFile(symbolicVersionAlias)
  }

  registerSiteStartPage (startPageSpec) {
    if (!startPageSpec) return
    const rel = this.resolvePage(startPageSpec)
    if (rel) {
      return this.addFile({ mediaType: 'text/html', src: inflateSrc(Object.assign({}, START_ALIAS_ID), 'alias'), rel })
    } else if (rel === false) {
      console.warn(`Start page specified for site has invalid syntax: ${startPageSpec}`)
    } else if (~startPageSpec.indexOf(':')) {
      console.warn(`Start page specified for site not found: ${startPageSpec}`)
    } else {
      console.warn(`Missing component name in start page for site: ${startPageSpec}`)
    }
  }

  // QUESTION should this be addPageAlias?
  registerPageAlias (spec, target) {
    const src = parseResourceId(spec, target.src, 'page', ['page'])
    // QUESTION should we throw an error if alias is invalid?
    if (!src) return
    const component = this.getComponent(src.component)
    if (component) {
      // NOTE version is not set when alias specifies a component, but not a version
      if (!src.version) src.version = component.latest.version
      const existingPage = this.getById(src)
      if (existingPage) {
        throw new Error(
          existingPage === target
            ? `Page cannot define alias that references itself: ${generateResourceSpec(src)}` +
              ` (specified as: ${spec})\n  source: ${getFileLocation(existingPage)}`
            : `Page alias cannot reference an existing page: ${generateResourceSpec(src)} (specified as: ${spec})\n` +
              `  source: ${getFileLocation(target)}\n` +
              `  existing page: ${getFileLocation(existingPage)}`
        )
      }
      const existingAlias = this.getById(Object.assign({}, src, { family: 'alias' }))
      if (existingAlias) {
        throw new Error(
          `Duplicate alias: ${generateResourceSpec(src)} (specified as: ${spec})\n` +
            `  source: ${getFileLocation(target)}`
        )
      }
    } else if (!src.version) {
      // QUESTION should we skip registering alias in this case?
      src.version = 'master'
    }
    // QUESTION should we use src.origin instead of rel with type='link'?
    //src.origin = { type: 'link', target }
    // NOTE the redirect producer will populate contents when the redirect facility is 'static'
    //const path_ = path.join(targetPage.path.slice(0, -targetPage.src.relative.length), src.relative)
    return this.addFile({ mediaType: 'text/html', src: inflateSrc(src, 'alias'), rel: target })
  }

  /**
   * Attempts to resolve a string contextual page ID spec to a file in the catalog.
   *
   * Parses the specified contextual page ID spec into a page ID object, then attempts to lookup a
   * file with this page ID in the catalog. If a component is specified, but not a version, the
   * latest version of the component stored in the catalog is used. If a file cannot be resolved,
   * the function returns undefined. If the spec does not match the page ID syntax, this function
   * throws an error.
   *
   * @param {String} spec - The contextual page ID spec (e.g., version@component:module:topic/page.adoc).
   * @param {ContentCatalog} catalog - The content catalog in which to resolve the page file.
   * @param {Object} [ctx={}] - The context to use to qualified the contextual page ID.
   *
   * @return {File} The virtual file to which the contextual page ID spec refers, or undefined if the
   * file cannot be resolved.
   */
  resolvePage (spec, context = {}) {
    return this.resolveResource(spec, context, 'page', ['page'])
  }

  resolveResource (spec, context = {}, defaultFamily = undefined, permittedFamilies = undefined) {
    return resolveResource(spec, this, context, defaultFamily, permittedFamilies)
  }

  exportToModel () {
    return Object.assign(
      new (class ContentCatalogProxy {})(),
      [
        this.findBy,
        this.getAll,
        this.getById,
        this.getComponent,
        this.getComponentVersion,
        this.getComponents,
        this.getComponentsSortedBy,
        this.getPages,
        this.getSiteStartPage,
        this.resolvePage,
        this.resolveResource,
      ].reduce((accum, method) => (accum[method.name] = method.bind(this)) && accum, {})
    )
  }
}

/**
 * @deprecated superceded by getAll()
 */
ContentCatalog.prototype.getFiles = ContentCatalog.prototype.getAll

function generateKey ({ component, version, module: module_, family, relative }) {
  return `${version}@${component}:${module_}:${family}$${relative}`
}

function generateResourceSpec ({ component, version, module: module_, family, relative }, shorthand = true) {
  //if (module_ == null && family === 'nav') return `${version}@${component}:nav$${relative}`
  return (
    `${version}@${component}:${shorthand && module_ === 'ROOT' ? '' : module_}:` +
    (family === 'page' || family === 'alias' ? '' : `${family}$`) +
    relative
  )
}

function inflateSrc (src, family = 'page', mediaType = 'text/asciidoc') {
  const basename = (src.basename = path.basename(src.relative))
  const extIdx = basename.lastIndexOf('.')
  if (~extIdx) {
    src.stem = basename.substr(0, extIdx)
    src.extname = basename.substr(extIdx)
  } else {
    src.stem = basename
    src.extname = ''
  }
  src.family = family
  src.mediaType = mediaType
  return src
}

function computeOut (src, family, version, htmlUrlExtensionStyle) {
  const component = src.component
  const module_ = src.module === 'ROOT' ? '' : src.module

  let basename = src.basename || path.basename(src.relative)
  const stem = src.stem || basename.substr(0, (basename.lastIndexOf('.') + 1 || basename.length + 1) - 1)
  let indexifyPathSegment = ''
  let familyPathSegment = ''

  if (family === 'page') {
    if (stem !== 'index' && htmlUrlExtensionStyle === 'indexify') {
      basename = 'index.html'
      indexifyPathSegment = stem
    } else if (src.mediaType === 'text/asciidoc') {
      basename = stem + '.html'
    }
  } else if (family === 'image') {
    familyPathSegment = '_images'
  } else if (family === 'attachment') {
    familyPathSegment = '_attachments'
  }

  const modulePath = path.join(component, version, module_)
  const dirname = path.join(modulePath, familyPathSegment, path.dirname(src.relative), indexifyPathSegment)
  const path_ = path.join(dirname, basename)
  const moduleRootPath = path.relative(dirname, modulePath) || '.'
  const rootPath = path.relative(dirname, '') || '.'

  return { dirname, basename, path: path_, moduleRootPath, rootPath }
}

function computePub (src, out, family, version, htmlUrlExtensionStyle) {
  const pub = {}
  let url
  if (family === 'nav') {
    const urlSegments = version ? [src.component, version] : [src.component]
    if (src.module && src.module !== 'ROOT') urlSegments.push(src.module)
    // an artificial URL used for resolving page references in navigation model
    url = '/' + urlSegments.join('/') + '/'
    pub.moduleRootPath = '.'
  } else if (family === 'page') {
    const urlSegments = out.path.split('/')
    const lastUrlSegmentIdx = urlSegments.length - 1
    if (htmlUrlExtensionStyle === 'drop') {
      // drop just the .html extension or, if the filename is index.html, the whole segment
      const lastUrlSegment = urlSegments[lastUrlSegmentIdx]
      urlSegments[lastUrlSegmentIdx] =
        lastUrlSegment === 'index.html' ? '' : lastUrlSegment.substr(0, lastUrlSegment.length - 5)
    } else if (htmlUrlExtensionStyle === 'indexify') {
      urlSegments[lastUrlSegmentIdx] = ''
    }
    url = '/' + urlSegments.join('/')
  } else {
    url = '/' + out.path
    if (family === 'alias' && !src.relative.length) pub.splat = true
  }

  pub.url = ~url.indexOf(' ') ? url.replace(SPACE_RX, '%20') : url

  if (out) {
    pub.moduleRootPath = out.moduleRootPath
    pub.rootPath = out.rootPath
  }

  return pub
}

function computeVersionSegment (name, version, mode) {
  if (mode === 'original') return version === 'master' ? '' : version
  const strategy = this.latestVersionUrlSegmentStrategy
  // NOTE: special exception; revisit in Antora 3
  if (version === 'master') {
    if (mode !== 'alias') return ''
    if (strategy === 'redirect:to') return
  }
  if (strategy === 'redirect:to' || strategy === (mode === 'alias' ? 'redirect:from' : 'replace')) {
    const component = this.getComponent(name)
    const componentVersion = component && this.getComponentVersion(component, version)
    if (componentVersion) {
      const segment =
        componentVersion === component.latest
          ? this.latestVersionUrlSegment
          : componentVersion.prerelease && componentVersion === component.versions[0]
            ? this.latestPrereleaseVersionUrlSegment
            : undefined
      return segment == null ? version : segment
    }
  }
  return version
}

function createSymbolicVersionAlias (name, version, symbolicVersionSegment, strategy) {
  if (symbolicVersionSegment == null || symbolicVersionSegment === version) return
  const versionAliasFamily = 'alias'
  const baseVersionAliasSrc = { component: name, module: 'ROOT', family: versionAliasFamily, relative: '' }
  const symbolicVersionAliasSrc = Object.assign({}, baseVersionAliasSrc, { version: symbolicVersionSegment })
  const symbolicVersionAlias = {
    mediaType: 'text/html',
    src: symbolicVersionAliasSrc,
    pub: computePub(
      symbolicVersionAliasSrc,
      computeOut(symbolicVersionAliasSrc, versionAliasFamily, symbolicVersionSegment),
      versionAliasFamily
    ),
  }
  const originalVersionAliasSrc = Object.assign({}, baseVersionAliasSrc, { version })
  const originalVersionSegment = computeVersionSegment(name, version, 'original')
  const originalVersionAlias = {
    mediaType: 'text/html',
    src: originalVersionAliasSrc,
    pub: computePub(
      originalVersionAliasSrc,
      computeOut(originalVersionAliasSrc, versionAliasFamily, originalVersionSegment),
      versionAliasFamily
    ),
  }
  if (strategy === 'redirect:to') {
    originalVersionAlias.out = undefined
    originalVersionAlias.rel = symbolicVersionAlias
    return originalVersionAlias
  } else {
    symbolicVersionAlias.out = undefined
    symbolicVersionAlias.rel = originalVersionAlias
    return symbolicVersionAlias
  }
}

function getFileLocation ({ path: path_, src: { abspath, origin } }) {
  return (
    abspath ||
    (origin ? `${path.join(origin.startPath, path_)} in ${origin.url} (ref: ${origin.branch || origin.tag})` : path_)
  )
}

module.exports = ContentCatalog

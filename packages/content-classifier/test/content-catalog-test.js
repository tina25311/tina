/* eslint-env mocha */
'use strict'

const { captureLogSync, expect, spy } = require('@antora/test-harness')

const classifyContent = require('@antora/content-classifier')
const ContentCatalog = require('@antora/content-classifier/content-catalog')
const File = require('@antora/content-classifier/file')
const { posix: path } = require('path')

const { ROOT_INDEX_PAGE_ID } = require('#constants')

// TODO change these to pure unit tests that don't rely on the classifyContent function
describe('ContentCatalog', () => {
  let playbook
  let aggregate

  const createFile = (path_) => {
    const basename = path.basename(path_)
    const extname = path.extname(path_)
    const stem = path.basename(path_, extname)
    return new File({ path: path_, src: { path: path_, basename, extname, stem } })
  }

  beforeEach(() => {
    playbook = {
      site: {},
      urls: { htmlExtensionStyle: 'default' },
    }
  })

  describe('#getComponentsSortedBy()', () => {
    it('should return components sorted by title', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('foo', '1.0', { title: 'Foo' })
      contentCatalog.registerComponentVersion('bar', '1.0', { title: 'Bar' })
      contentCatalog.registerComponentVersion('yin', '1.0', { title: 'Yin' })
      contentCatalog.registerComponentVersion('yang', '1.0', { title: 'Yang' })
      const components = contentCatalog.getComponentsSortedBy('title')
      expect(components.map((v) => v.title)).to.eql(['Bar', 'Foo', 'Yang', 'Yin'])
    })
  })

  describe('#registerComponentVersion()', () => {
    it('should add new component to catalog and return component version if component is not present', () => {
      const name = 'the-component'
      const version = '1.0.0'
      const title = 'The Component'
      const url = '/the-component/1.0.0/index.html'
      const contentCatalog = new ContentCatalog()
      const descriptor = { title, startPage: true }
      expect(contentCatalog.getComponents()).to.be.empty()
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'index.adoc',
        },
      })
      const componentVersion = contentCatalog.registerComponentVersion(name, version, descriptor)
      expect(componentVersion).to.exist()
      const components = contentCatalog.getComponents()
      expect(components).to.have.lengthOf(1)
      expect(components[0]).to.deep.include({
        name,
        title,
        url,
        versions: [{ name, version, displayVersion: version, title, url }],
      })
      expect(components[0].latest).to.eql({ name, version, displayVersion: version, title, url })
      expect(components[0]).to.not.have.property('latestVersion')
      expect(components[0].latestPrerelease).to.be.undefined()
    })

    it('should add new version to existing component and return it if component is already present', () => {
      const name = 'the-component'
      const version1 = '1.0.0'
      const title1 = 'The Component (1.0.0)'
      const descriptor1 = { title: title1, startPage: true }
      const url1 = '/the-component/1.0.0/index.html'
      const version2 = '2.0.0'
      const title2 = 'The Component (2.0.0)'
      const descriptor2 = { title: title2, startPage: true }
      const url2 = '/the-component/2.0.0/index.html'
      const indexPageT = { family: 'page', relative: 'index.adoc' }
      const contentCatalog = new ContentCatalog()
      contentCatalog.addFile({ src: { ...indexPageT, component: name, version: version1, module: 'ROOT' } })
      const componentVersion1 = contentCatalog.registerComponentVersion(name, version1, descriptor1)
      expect(componentVersion1).to.exist()
      expect(contentCatalog.getComponents()).to.have.lengthOf(1)
      const component = contentCatalog.getComponent(name)
      expect(component.latest).to.equal(componentVersion1)

      contentCatalog.addFile({ src: { ...indexPageT, component: name, version: version2, module: 'ROOT' } })
      const componentVersion2 = contentCatalog.registerComponentVersion(name, version2, descriptor2)
      expect(componentVersion2).to.exist()
      expect(contentCatalog.getComponents()).to.have.lengthOf(1)
      expect(contentCatalog.getComponent(name)).to.equal(component)
      expect(component).to.deep.include({
        name,
        title: title2,
        url: url2,
        versions: [
          { name, version: version2, displayVersion: version2, title: title2, url: url2 },
          { name, version: version1, displayVersion: version1, title: title1, url: url1 },
        ],
      })
      expect(component.latest).to.eql({
        name,
        version: version2,
        displayVersion: version2,
        title: title2,
        url: url2,
      })
      expect(component.latest).to.equal(componentVersion2)
    })

    it('should throw error if component version already exists', () => {
      const contentCatalog = new ContentCatalog()
      expect(() => {
        contentCatalog.registerComponentVersion('the-component', '1.0.0')
        contentCatalog.registerComponentVersion('the-component', '1.0.0')
      }).to.throw('Duplicate version detected for component')
    })

    it('should throw error if component version already exists with different prerelease value', () => {
      const contentCatalog = new ContentCatalog()
      expect(() => {
        contentCatalog.registerComponentVersion('the-component', '1.0.0')
        contentCatalog.registerComponentVersion('the-component', '2.0.0')
        contentCatalog.registerComponentVersion('the-component', 'dev', { prerelease: true })
        contentCatalog.registerComponentVersion('the-component', '1.0.0', { prerelease: true })
      }).to.throw('Duplicate version detected for component')
    })

    it('should add component version that has same comparison value as existing version', () => {
      const contentCatalog = new ContentCatalog()
      expect(() => {
        contentCatalog.registerComponentVersion('the-component', 'r.y')
        contentCatalog.registerComponentVersion('the-component', 'r.x')
      }).to.not.throw()
      const component = contentCatalog.getComponent('the-component')
      const versions = component.versions
      expect(versions).to.have.lengthOf(2)
      expect(versions[0].version).to.equal('r.y')
      expect(versions[1].version).to.equal('r.x')
    })

    it('should not use prerelease as a latest version', () => {
      const srcTemplate = { family: 'page', relative: 'index.adoc' }
      const componentName = 'the-component'
      const version1 = '1.0.0'
      const title1 = 'The Component (1.0.0)'
      const url1 = '/the-component/1.0.0/index.html'
      const descriptor1 = { title: title1, startPage: true }
      const src1 = { ...srcTemplate, component: componentName, version: version1, module: 'ROOT' }
      const version2 = '2.0.0'
      const title2 = 'The Component (2.0.0)'
      const url2 = '/the-component/2.0.0/index.html'
      const prerelease2 = true
      const descriptor2 = { title: title2, prerelease: prerelease2, startPage: true }
      const src2 = { ...srcTemplate, component: componentName, version: version2, module: 'ROOT' }
      const contentCatalog = new ContentCatalog()

      contentCatalog.addFile({ src: src1 })
      contentCatalog.registerComponentVersion(componentName, version1, descriptor1)
      expect(contentCatalog.getComponents()).to.have.lengthOf(1)
      const component = contentCatalog.getComponent(componentName)

      contentCatalog.addFile({ src: src2 })
      contentCatalog.registerComponentVersion(componentName, version2, descriptor2)
      expect(contentCatalog.getComponents()).to.have.lengthOf(1)
      expect(contentCatalog.getComponent(componentName)).to.equal(component)

      expect(component.versions).to.eql([
        {
          name: componentName,
          version: version2,
          displayVersion: version2,
          title: title2,
          url: url2,
          prerelease: prerelease2,
        },
        {
          name: componentName,
          version: version1,
          displayVersion: version1,
          title: title1,
          url: url1,
        },
      ])
      expect(component.latest).to.eql({
        name: componentName,
        version: version1,
        displayVersion: version1,
        title: title1,
        url: url1,
      })
      expect(component.latestPrerelease).to.eql({
        name: componentName,
        version: version2,
        prerelease: true,
        displayVersion: version2,
        title: title2,
        url: url2,
      })
      expect(component.name).to.equal(componentName)
      expect(component.title).to.equal(title1)
      expect(component.url).to.equal(url1)
    })

    it('should point latest to newest version if all versions are prereleases', () => {
      const srcTemplate = { family: 'page', relative: 'index.adoc' }
      const componentName = 'the-component'
      const version1 = '1.0.0'
      const title1 = 'The Component (1.0.0)'
      const url1 = '/the-component/1.0.0/index.html'
      const prerelease1 = true
      const descriptor1 = { title: title1, prerelease: prerelease1, startPage: true }
      const src1 = { ...srcTemplate, component: componentName, version: version1, module: 'ROOT' }
      const version2 = '2.0.0'
      const title2 = 'The Component (2.0.0)'
      const url2 = '/the-component/2.0.0/index.html'
      const prerelease2 = true
      const descriptor2 = { title: title2, prerelease: prerelease2, startPage: true }
      const src2 = { ...srcTemplate, component: componentName, version: version2, module: 'ROOT' }
      const contentCatalog = new ContentCatalog()

      contentCatalog.addFile({ src: src1 })
      contentCatalog.registerComponentVersion(componentName, version1, descriptor1)
      expect(contentCatalog.getComponents()).to.have.lengthOf(1)
      const component = contentCatalog.getComponent(componentName)

      contentCatalog.addFile({ src: src2 })
      contentCatalog.registerComponentVersion(componentName, version2, descriptor2)
      expect(contentCatalog.getComponents()).to.have.lengthOf(1)
      expect(contentCatalog.getComponent(componentName)).to.equal(component)

      expect(component.versions).to.eql([
        {
          name: componentName,
          version: version2,
          displayVersion: version2,
          title: title2,
          url: url2,
          prerelease: prerelease2,
        },
        {
          name: componentName,
          version: version1,
          displayVersion: version1,
          title: title1,
          url: url1,
          prerelease: prerelease1,
        },
      ])
      expect(component.latest).to.eql({
        name: componentName,
        version: version2,
        displayVersion: version2,
        title: title2,
        url: url2,
        prerelease: prerelease2,
      })
      expect(component.latestPrerelease).to.be.undefined()
      expect(component.name).to.equal(componentName)
      expect(component.title).to.equal(title2)
      expect(component.url).to.equal(url2)
    })

    it('should set displayVersion property to specified value', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'ACME', displayVersion: '1.0 Beta' })
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      expect(component.versions[0]).to.exist()
      expect(component.versions[0].displayVersion).to.equal('1.0 Beta')
    })

    it('should set displayVersion property to "default" if version is empty and displayVersion is not specified', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('the-component', '', { title: 'ACME' })
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      expect(component.versions[0]).to.exist()
      expect(component.versions[0].displayVersion).to.equal('default')
    })

    it('should set displayVersion property automatically if prerelease is a string literal', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'ACME', prerelease: 'Beta' })
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      expect(component.versions[0]).to.exist()
      expect(component.versions[0].prerelease).to.equal('Beta')
      expect(component.versions[0].displayVersion).to.equal('1.0 Beta')
    })

    it('should set displayVersion property automatically if prerelease is a string object', () => {
      const contentCatalog = new ContentCatalog()
      const prerelease = new String('Beta') // eslint-disable-line no-new-wrappers
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'ACME', prerelease })
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      expect(component.versions[0]).to.exist()
      expect(component.versions[0].prerelease.toString()).to.equal('Beta')
      expect(component.versions[0].displayVersion).to.equal('1.0 Beta')
    })

    it('should not offset prerelease label by space in displayVersion property if begins with dot or hyphen', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'ACME', prerelease: '-dev' })
      contentCatalog.registerComponentVersion('the-other-component', '1.0', { title: 'XYZ', prerelease: '.beta.1' })
      let component
      component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      expect(component.versions[0]).to.exist()
      expect(component.versions[0].prerelease).to.equal('-dev')
      expect(component.versions[0].displayVersion).to.equal('1.0-dev')
      component = contentCatalog.getComponent('the-other-component')
      expect(component).to.exist()
      expect(component.versions[0]).to.exist()
      expect(component.versions[0].prerelease).to.equal('.beta.1')
      expect(component.versions[0].displayVersion).to.equal('1.0.beta.1')
    })

    it('should use url from specified start page', () => {
      const name = 'the-component'
      const version = '1.0.0'
      const title = 'The Component'
      const descriptor = { title, startPage: 'home.adoc' }
      const url = '/the-component/1.0.0/home.html'
      const contentCatalog = new ContentCatalog()
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'home.adoc',
        },
      })
      contentCatalog.registerComponentVersion(name, version, descriptor)
      const components = contentCatalog.getComponents()
      expect(components).to.have.lengthOf(1)
      expect(components[0]).to.deep.include({
        name,
        title,
        url,
        versions: [{ name, version, displayVersion: version, title, url }],
      })
      expect(components[0].latest).to.eql({ name, version, displayVersion: version, title, url })
    })

    it('should not register start page if startPage property in descriptor is absent', () => {
      const name = 'the-component'
      const version = '1.0.0'
      const title = 'The Component'
      const descriptor = { title }
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion(name, version, descriptor)
      const components = contentCatalog.getComponents()
      expect(components).to.have.lengthOf(1)
      expect(components[0].url).to.be.undefined()
      expect(components[0].latest).to.not.have.property('url')
      expect(components[0]).to.deep.include({
        name,
        title,
        versions: [{ name, version, displayVersion: version, title }],
      })
    })

    it('should not register start page if value of startPage property in descriptor is undefined', () => {
      const name = 'the-component'
      const version = '1.0.0'
      const title = 'The Component'
      const descriptor = { title, startPage: undefined }
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion(name, version, descriptor)
      const components = contentCatalog.getComponents()
      expect(components).to.have.lengthOf(1)
      expect(components[0].url).to.be.undefined()
      expect(components[0].latest).to.not.have.property('url')
      expect(components[0]).to.deep.include({
        name,
        title,
        versions: [{ name, version, displayVersion: version, title }],
      })
    })

    it('should register alias at index page if start page differs from index page and index page does not exist', () => {
      const name = 'the-component'
      const version = '1.0'
      const title = 'The Component'
      const url = '/the-component/1.0/home.html'
      const contentCatalog = new ContentCatalog()
      const startPage = contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'home.adoc',
        },
      })
      contentCatalog.registerComponentVersion(name, version, { title, startPage: 'home.adoc' })
      const component = contentCatalog.getComponent(name)
      expect(component.url).to.equal(url)
      const aliases = contentCatalog.findBy({ family: 'alias' })
      expect(aliases).to.have.lengthOf(1)
      const indexPageAlias = aliases[0]
      expect(indexPageAlias.src).to.include({
        component: name,
        version,
        module: 'ROOT',
        relative: 'index.adoc',
      })
      expect(indexPageAlias.rel).to.equal(startPage)
    })

    it('should not register alias at index page if start page differs from index page and index page exists', () => {
      const name = 'the-component'
      const version = '1.0'
      const title = 'The Component'
      const url = '/the-component/1.0/home.html'
      const contentCatalog = new ContentCatalog()
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'index.adoc',
        },
      })
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'home.adoc',
        },
      })
      contentCatalog.registerComponentVersion(name, version, { title, startPage: 'home.adoc' })
      const component = contentCatalog.getComponent(name)
      expect(component.url).to.equal(url)
      const aliases = contentCatalog.findBy({ family: 'alias' })
      expect(aliases).to.be.empty()
    })

    it('should use url of index page in ROOT module if found', () => {
      const name = 'the-component'
      const version = '1.0'
      const title = 'The Component'
      const url = '/the-component/1.0/index.html'
      const contentCatalog = new ContentCatalog()
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'home.adoc',
        },
      })
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'index.adoc',
        },
      })
      contentCatalog.registerComponentVersion(name, version, { title, startPage: true })
      const component = contentCatalog.getComponent(name)
      expect(component.url).to.equal(url)
      expect(contentCatalog.findBy({ family: 'alias' })).to.be.empty()
    })

    it('should use url of synthetic index page in ROOT module if page not found', () => {
      const name = 'the-component'
      const version = '1.0.0'
      const title = 'The Component'
      const url = '/the-component/1.0.0/index.html'
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion(name, version, { title, startPage: true })
      const component = contentCatalog.getComponent(name)
      expect(component.url).to.equal(url)
    })

    it('should store scoped AsciiDoc config on component version', () => {
      const contentCatalog = new ContentCatalog()
      const asciidocConfig = { attributes: { foo: 'bar' } }
      const descriptor = {
        title: 'ACME',
        displayVersion: '1.0 Beta',
        asciidoc: asciidocConfig,
      }
      contentCatalog.registerComponentVersion('the-component', '1.0', descriptor)
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      expect(component.versions[0]).to.exist()
      expect(component.versions[0].asciidoc).to.eql(asciidocConfig)
    })
  })

  describe('#registerComponentVersionStartPage()', () => {
    it('should register component version start page as synthetic alias', () => {
      const name = 'the-component'
      const version = '1.0.0'
      const contentCatalog = new ContentCatalog()
      const componentVersion = contentCatalog.registerComponentVersion(name, version)
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'home.adoc',
        },
      })
      const homePage = contentCatalog.getFiles()[0]
      contentCatalog.registerComponentVersionStartPage(name, componentVersion, 'home.adoc')
      expect(contentCatalog.getFiles()).to.have.lengthOf(2)
      const indexAlias = contentCatalog.getById({
        component: name,
        version,
        module: 'ROOT',
        family: 'alias',
        relative: 'index.adoc',
      })
      expect(indexAlias).to.exist()
      expect(indexAlias.rel).to.equal(homePage)
      expect(indexAlias.synthetic).to.be.true()
    })

    it('should allow synthetic component version start page to be updated', () => {
      const name = 'the-component'
      const version = '1.0.0'
      const contentCatalog = new ContentCatalog()
      const componentVersion = contentCatalog.registerComponentVersion(name, version)
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'home.adoc',
        },
      })
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'start.adoc',
        },
      })
      contentCatalog.registerComponentVersionStartPage(name, componentVersion, 'home.adoc')
      contentCatalog.registerComponentVersionStartPage(name, componentVersion, 'start.adoc')
      expect(contentCatalog.getFiles()).to.have.lengthOf(3)
      const indexAlias = contentCatalog.getById({
        component: name,
        version,
        module: 'ROOT',
        family: 'alias',
        relative: 'index.adoc',
      })
      expect(indexAlias).to.exist()
      expect(indexAlias.rel.src.relative).to.equal('start.adoc')
      expect(indexAlias.synthetic).to.be.true()
    })

    it('should use url from specified start page', () => {
      const name = 'the-component'
      const version = '1.0.0'
      const title = 'The Component'
      const url = '/the-component/1.0.0/home.html'
      const contentCatalog = new ContentCatalog()
      const componentVersion = contentCatalog.registerComponentVersion(name, version, { title })
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'home.adoc',
        },
      })
      contentCatalog.registerComponentVersionStartPage(name, componentVersion, 'home.adoc')
      const components = contentCatalog.getComponents()
      expect(components).to.have.lengthOf(1)
      expect(components[0]).to.deep.include({
        name,
        title,
        url,
        versions: [{ name, version, displayVersion: version, title, url }],
      })
      expect(components[0].latest).to.eql({ name, version, displayVersion: version, title, url })
    })

    it('should respect htmlUrlExtensionStyle setting when computing default start page', () => {
      const contentCatalog = new ContentCatalog({ urls: { htmlExtensionStyle: 'indexify' } })
      const descriptor = { title: 'The Component' }
      const componentVersion = contentCatalog.registerComponentVersion('the-component', '1.0', descriptor)
      contentCatalog.registerComponentVersionStartPage('the-component', '1.0')
      expect(componentVersion.url).to.equal('/the-component/1.0/')
    })

    it('should warn if specified start page not found', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'The Component' })
      const messages = captureLogSync(() =>
        contentCatalog.registerComponentVersionStartPage('the-component', '1.0', 'home.adoc')
      )
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.equal('Start page specified for 1.0@the-component not found: home.adoc')
    })

    it('should warn if specified start page does not have the .adoc file extension', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'The Component' })
      const messages = captureLogSync(() =>
        contentCatalog.registerComponentVersionStartPage('the-component', '1.0', 'home')
      )
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.equal('Start page specified for 1.0@the-component not found: home')
    })

    it('should warn if specified start page refers to a different component', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.addFile({
        src: {
          component: 'other-component',
          version: '2.0',
          module: 'ROOT',
          family: 'page',
          relative: 'start.adoc',
        },
      })
      contentCatalog.registerComponentVersion('other-component', '2.0', { title: 'Other Component', startPage: true })
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'The Component' })
      const messages = captureLogSync(() =>
        contentCatalog.registerComponentVersionStartPage('the-component', '1.0', 'other-component::start.adoc')
      )
      const expectedMessage = 'Start page specified for 1.0@the-component not found: other-component::start.adoc'
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.equal(expectedMessage)
    })

    it('should warn if specified start page refers to a different component version', () => {
      const contentCatalog = new ContentCatalog()
      contentCatalog.addFile({
        src: {
          component: 'the-component',
          version: '2.0',
          module: 'ROOT',
          family: 'page',
          relative: 'start.adoc',
        },
      })
      contentCatalog.registerComponentVersion('the-component', '2.0', { title: 'The Component', startPage: true })
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'The Component' })
      const messages = captureLogSync(() =>
        contentCatalog.registerComponentVersionStartPage('the-component', '1.0', '2.0@start.adoc')
      )
      const expectedMessage = 'Start page specified for 1.0@the-component not found: 2.0@start.adoc'
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.equal(expectedMessage)
    })

    it('should register splat alias for component version if strategy is redirect:from but not replace latest version in pub.url/out.path', () => {
      const contentCatalog = new ContentCatalog({
        urls: {
          latestVersionSegmentStrategy: 'redirect:from',
          latestVersionSegment: 'current',
        },
      })
      const componentVersion = contentCatalog.registerComponentVersion('the-component', '1.2.3', {
        title: 'The Component',
        startPage: undefined,
      })
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const result = contentCatalog.addFile({ src })
      contentCatalog.registerComponentVersionStartPage('the-component', componentVersion)
      expect(componentVersion.version).to.equal('1.2.3')
      expect(componentVersion.url).to.equal('/the-component/1.2.3/index.html')
      const splatVersionAlias = contentCatalog.getById({
        component: 'the-component',
        version: 'current',
        module: 'ROOT',
        family: 'alias',
        relative: '',
      })
      expect(splatVersionAlias).to.exist()
      expect(splatVersionAlias.pub.url).to.equal('/the-component/current')
      expect(splatVersionAlias.pub.splat).to.be.true()
      expect(splatVersionAlias.pub.rootPath).to.equal('../..')
      expect(splatVersionAlias.rel.pub.url).to.equal('/the-component/1.2.3')
      expect(splatVersionAlias.rel.pub.splat).to.be.true()
      expect(splatVersionAlias.rel.pub.rootPath).to.equal('../..')
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/1.2.3/the-page.html', rootPath: '../..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/1.2.3/the-page.html', rootPath: '../..' })
    })

    it('should register splat alias for versionless component version if strategy is redirect:from', () => {
      const contentCatalog = new ContentCatalog({
        urls: {
          latestVersionSegmentStrategy: 'redirect:from',
          latestVersionSegment: 'current',
        },
      })
      const componentVersion = contentCatalog.registerComponentVersion('the-component', '', {
        title: 'The Component',
        startPage: undefined,
      })
      contentCatalog.registerComponentVersionStartPage('the-component', componentVersion)
      expect(componentVersion.version).to.equal('')
      expect(componentVersion.url).to.equal('/the-component/index.html')
      const splatVersionAlias = contentCatalog.getById({
        component: 'the-component',
        version: 'current',
        module: 'ROOT',
        family: 'alias',
        relative: '',
      })
      expect(splatVersionAlias).to.exist()
      expect(splatVersionAlias.pub.url).to.equal('/the-component/current')
      expect(splatVersionAlias.pub.splat).to.be.true()
      expect(splatVersionAlias.pub.rootPath).to.equal('../..')
      expect(splatVersionAlias.rel.pub.url).to.equal('/the-component')
      expect(splatVersionAlias.rel.pub.splat).to.be.true()
      expect(splatVersionAlias.rel.pub.rootPath).to.equal('..')
    })

    it('should not register splat alias for component version if strategy is redirect:from and symbolic name matches version', () => {
      const contentCatalog = new ContentCatalog({
        urls: {
          latestVersionSegmentStrategy: 'redirect:from',
          latestVersionSegment: 'latest',
        },
      })
      const componentVersion = contentCatalog.registerComponentVersion('the-component', 'latest', {
        title: 'The Component',
        startPage: undefined,
      })
      contentCatalog.registerComponentVersionStartPage('the-component', componentVersion)
      expect(componentVersion.version).to.equal('latest')
      expect(componentVersion.url).to.equal('/the-component/latest/index.html')
      const splatVersionAlias = contentCatalog.getById({
        component: 'the-component',
        version: 'latest',
        module: 'ROOT',
        family: 'alias',
        relative: '',
      })
      expect(splatVersionAlias).to.not.exist()
    })

    it('should register splat alias for component version if strategy is redirect:to and replace latest version in pub.url/out.path', () => {
      const contentCatalog = new ContentCatalog({
        urls: {
          latestVersionSegmentStrategy: 'redirect:to',
          latestVersionSegment: 'current',
        },
      })
      const componentVersion = contentCatalog.registerComponentVersion('the-component', '1.2.3', {
        title: 'The Component',
        startPage: undefined,
      })
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const result = contentCatalog.addFile({ src })
      contentCatalog.registerComponentVersionStartPage('the-component', componentVersion)
      expect(componentVersion.version).to.equal('1.2.3')
      expect(componentVersion.url).to.equal('/the-component/current/index.html')
      const splatVersionAlias = contentCatalog.getById({
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'alias',
        relative: '',
      })
      expect(splatVersionAlias).to.exist()
      expect(splatVersionAlias.pub.url).to.equal('/the-component/1.2.3')
      expect(splatVersionAlias.pub.splat).to.be.true()
      expect(splatVersionAlias.pub.rootPath).to.equal('../..')
      expect(splatVersionAlias.rel.pub.url).to.equal('/the-component/current')
      expect(splatVersionAlias.rel.pub.splat).to.be.true()
      expect(splatVersionAlias.rel.pub.rootPath).to.equal('../..')
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/current/the-page.html', rootPath: '../..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/current/the-page.html', rootPath: '../..' })
    })

    it('should not register splat alias for component version if strategy is redirect:to and symbolic name matches version', () => {
      const contentCatalog = new ContentCatalog({
        urls: {
          latestVersionSegmentStrategy: 'redirect:to',
          latestVersionSegment: 'latest',
        },
      })
      const componentVersion = contentCatalog.registerComponentVersion('the-component', 'latest', {
        title: 'The Component',
      })
      contentCatalog.registerComponentVersionStartPage('the-component', componentVersion)
      expect(componentVersion.version).to.equal('latest')
      expect(componentVersion.url).to.equal('/the-component/latest/index.html')
      const splatVersionAlias = contentCatalog.getById({
        component: 'the-component',
        version: 'latest',
        module: 'ROOT',
        family: 'alias',
        relative: '',
      })
      expect(splatVersionAlias).to.not.exist()
    })

    it('should not register splat alias for versionless component version if strategy is redirect:to', () => {
      const contentCatalog = new ContentCatalog({
        urls: {
          latestVersionSegmentStrategy: 'redirect:to',
          latestVersionSegment: 'current',
        },
      })
      const componentVersion = contentCatalog.registerComponentVersion('the-component', '', {
        title: 'The Component',
        startPage: undefined,
      })
      contentCatalog.registerComponentVersionStartPage('the-component', componentVersion)
      expect(componentVersion.version).to.equal('')
      expect(componentVersion.url).to.equal('/the-component/index.html')
      const splatVersionAlias = contentCatalog.getById({
        component: 'the-component',
        version: '',
        module: 'ROOT',
        family: 'alias',
        relative: '',
      })
      expect(splatVersionAlias).to.not.exist()
    })

    it('should register splat alias for ROOT component when version segment is empty and strategy is redirect:to', () => {
      const contentCatalog = new ContentCatalog({
        urls: {
          latestVersionSegmentStrategy: 'redirect:to',
          latestVersionSegment: '',
        },
      })
      const componentVersion = contentCatalog.registerComponentVersion('ROOT', '3.0', {
        title: 'The Component',
        startPage: undefined,
      })
      contentCatalog.registerComponentVersionStartPage('ROOT', componentVersion)
      expect(componentVersion.version).to.equal('3.0')
      expect(componentVersion.url).to.equal('/index.html')
      const splatVersionAlias = contentCatalog.getById({
        component: 'ROOT',
        version: '3.0',
        module: 'ROOT',
        family: 'alias',
        relative: '',
      })
      expect(splatVersionAlias).to.exist()
      expect(splatVersionAlias.pub.url).to.equal('/3.0')
      expect(splatVersionAlias.pub.splat).to.be.true()
      expect(splatVersionAlias.pub.rootPath).to.equal('..')
      expect(splatVersionAlias.rel.pub.url).to.equal('/')
      expect(splatVersionAlias.rel.pub.splat).to.be.true()
      expect(splatVersionAlias.rel.pub.rootPath).to.equal('.')
    })
  })

  describe('#getComponentVersion()', () => {
    let contentCatalog

    beforeEach(() => {
      contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('the-component', '1.0.0', { title: 'The Component' })
      contentCatalog.registerComponentVersion('the-component', '2.0.0', { title: 'The Component' })
      contentCatalog.registerComponentVersion('the-other-component', '1.0.0', { title: 'The Other Component' })
    })

    it('should return the component version by component name and version', () => {
      const componentVersion = contentCatalog.getComponentVersion('the-component', '1.0.0')
      expect(componentVersion).to.exist()
      expect(componentVersion).to.include({ version: '1.0.0', title: 'The Component' })
    })

    it('should return the component version by component and version', () => {
      const component = contentCatalog.getComponent('the-component')
      const componentVersion = contentCatalog.getComponentVersion(component, '1.0.0')
      expect(componentVersion).to.exist()
      expect(componentVersion).to.include({ version: '1.0.0', title: 'The Component' })
    })

    it('should return undefined if the component name is not registered', () => {
      const componentVersion = contentCatalog.getComponentVersion('no-such-component', '1.0.0')
      expect(componentVersion).to.not.exist()
    })

    it('should return undefined if the version does not exist', () => {
      const componentVersion = contentCatalog.getComponentVersion('the-component', '3.0.0')
      expect(componentVersion).to.not.exist()
    })
  })

  describe('#getFiles()', () => {
    beforeEach(() => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v4.5.6',
          files: [
            createFile('modules/ROOT/assets/images/directory-structure.svg'),
            createFile('modules/ROOT/pages/page-one.adoc'),
            createFile('modules/ROOT/pages/page-two.adoc'),
            createFile('modules/ROOT/partials/foo.adoc'),
          ],
        },
        {
          name: 'the-other-component',
          title: 'The Other Title',
          version: 'v4.5.6',
          files: [createFile('modules/ROOT/pages/page-three.adoc')],
        },
      ]
    })

    it('should return all files in catalog', () => {
      const contentCatalog = classifyContent(playbook, aggregate)
      const files = contentCatalog.getFiles()
      expect(files).to.have.lengthOf(5)
      const pages = files.filter((it) => it.src.family === 'page')
      expect(pages).to.have.lengthOf(3)
      const partials = files.filter((it) => it.src.family === 'partial')
      expect(partials).to.have.lengthOf(1)
    })

    it('should map getAll as alias for getFiles', () => {
      const contentCatalog = classifyContent(playbook, aggregate)
      expect(contentCatalog.getAll).to.equal(contentCatalog.getFiles)
      const files = contentCatalog.getAll()
      expect(files).to.have.lengthOf(5)
      const pages = files.filter((it) => it.src.family === 'page')
      expect(pages).to.have.lengthOf(3)
      const partials = files.filter((it) => it.src.family === 'partial')
      expect(partials).to.have.lengthOf(1)
    })
  })

  describe('#getPages()', () => {
    beforeEach(() => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v4.5.6',
          files: [
            createFile('modules/ROOT/assets/images/launch-page.png'),
            createFile('modules/ROOT/pages/page-one.adoc'),
          ],
        },
        {
          name: 'the-other-component',
          title: 'The Other Component',
          version: 'v1.0.0',
          files: [createFile('modules/ROOT/pages/page-two.adoc')],
        },
      ]
    })

    it('should find all pages', () => {
      const contentCatalog = classifyContent(playbook, aggregate)
      const pages = contentCatalog.getPages()
      expect(pages.length).to.equal(2)
      pages.sort((a, b) => a.src.version.localeCompare(b.src.version) || a.path.localeCompare(b.path))
      expect(pages[0].path).to.equal('modules/ROOT/pages/page-two.adoc')
      expect(pages[0].src.version).to.equal('v1.0.0')
      expect(pages[1].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[1].src.version).to.equal('v4.5.6')
    })

    it('should find pages that match filter', () => {
      const contentCatalog = classifyContent(playbook, aggregate)
      const pages = contentCatalog.getPages((page) => page.src.version === 'v1.0.0')
      expect(pages.length).to.equal(1)
      expect(pages[0].path).to.equal('modules/ROOT/pages/page-two.adoc')
      expect(pages[0].src.version).to.equal('v1.0.0')
    })
  })

  describe('#findBy()', () => {
    beforeEach(() => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v4.5.6',
          files: [
            createFile('modules/ROOT/assets/images/launch-page.png'),
            createFile('modules/ROOT/pages/_partials/foo.adoc'),
            createFile('modules/ROOT/pages/page-one.adoc'),
            createFile('modules/ROOT/pages/page-two.adoc'),
            createFile('modules/ROOT/assets/images/directory-structure.svg'),
          ],
        },
        {
          name: 'the-other-component',
          title: 'The Other Title',
          version: 'v4.5.6',
          files: [
            createFile('modules/ROOT/pages/_partials/bar.adoc'),
            createFile('modules/ROOT/pages/page-three.adoc'),
          ],
        },
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          files: [createFile('modules/ROOT/pages/page-one.adoc'), createFile('modules/ROOT/assets/images/foo.png')],
        },
      ]
    })

    it('should find files by family', () => {
      const contentCatalog = classifyContent(playbook, aggregate)
      const numPages = contentCatalog.getPages().length
      const pages = contentCatalog.findBy({ family: 'page' })
      expect(pages).to.have.lengthOf(numPages)
      pages.sort((a, b) => a.src.version.localeCompare(b.src.version) || a.path.localeCompare(b.path))
      expect(pages[0].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[0].src.version).to.equal('v1.2.3')
      expect(pages[1].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[1].src.version).to.equal('v4.5.6')
      expect(pages[2].path).to.equal('modules/ROOT/pages/page-three.adoc')
      expect(pages[3].path).to.equal('modules/ROOT/pages/page-two.adoc')
    })

    it('should find files by component', () => {
      const pages = classifyContent(playbook, aggregate).findBy({ component: 'the-component' })
      expect(pages).to.have.lengthOf(7)
      pages.sort((a, b) => a.src.version.localeCompare(b.src.version) || a.path.localeCompare(b.path))
      expect(pages[0].path).to.equal('modules/ROOT/assets/images/foo.png')
      expect(pages[0].src.version).to.equal('v1.2.3')
      expect(pages[1].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[1].src.version).to.equal('v1.2.3')
      expect(pages[2].path).to.equal('modules/ROOT/assets/images/directory-structure.svg')
      expect(pages[2].src.version).to.equal('v4.5.6')
      expect(pages[3].path).to.equal('modules/ROOT/assets/images/launch-page.png')
      expect(pages[3].src.version).to.equal('v4.5.6')
      expect(pages[4].path).to.equal('modules/ROOT/pages/_partials/foo.adoc')
      expect(pages[4].src.version).to.equal('v4.5.6')
      expect(pages[5].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[5].src.version).to.equal('v4.5.6')
      expect(pages[6].path).to.equal('modules/ROOT/pages/page-two.adoc')
      expect(pages[6].src.version).to.equal('v4.5.6')
    })

    it('should find files by relative path', () => {
      const pages = classifyContent(playbook, aggregate).findBy({ relative: 'page-one.adoc' })
      expect(pages).to.have.lengthOf(2)
      pages.sort((a, b) => a.src.version.localeCompare(b.src.version))
      expect(pages[0].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[0].src.version).to.equal('v1.2.3')
      expect(pages[1].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[1].src.version).to.equal('v4.5.6')
    })

    it('should find files by extname', () => {
      const pages = classifyContent(playbook, aggregate).findBy({ extname: '.svg' })
      expect(pages).to.have.lengthOf(1)
      const page = pages[0]
      expect(page.path).to.equal('modules/ROOT/assets/images/directory-structure.svg')
      expect(page.src.version).to.equal('v4.5.6')
    })

    it('should find all versions of a page', () => {
      const pages = classifyContent(playbook, aggregate).findBy({
        component: 'the-component',
        module: 'ROOT',
        family: 'page',
        relative: 'page-one.adoc',
      })
      expect(pages).to.have.lengthOf(2)
      pages.sort((a, b) => a.src.version.localeCompare(b.src.version))
      expect(pages[0].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[0].src).to.include({ component: 'the-component', version: 'v1.2.3' })
      expect(pages[1].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(pages[1].src).to.include({ component: 'the-component', version: 'v4.5.6' })
    })
  })

  describe('#addFile()', () => {
    it('should return file registered', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const expectedSrc = { ...src, basename: 'the-page.adoc', extname: '.adoc', stem: 'the-page' }
      const contentCatalog = new ContentCatalog()
      const file = contentCatalog.addFile({ src })
      expect(file).to.be.instanceOf(File)
      expect(file).to.have.property('contents')
      expect(file).to.have.property('src')
      expect(file).to.have.property('mediaType')
      expect(file.src).to.include(expectedSrc)
      expect(file).to.equal(contentCatalog.getById(src))
    })

    // NOTE: in this case, src must be fully-populated
    it('should populate out and pub when called with vinyl file that has src property', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.equal(contentCatalog.getById(src))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/1.2.3/the-page.html', rootPath: '../..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/1.2.3/the-page.html', rootPath: '../..' })
    })

    it('should not change .adoc file extension to .html for attachments', () => {
      const pageSrc = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const attachmentSrc = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'attachment',
        relative: 'the-attachment.adoc',
        basename: 'the-attachment.adoc',
        extname: '.adoc',
        stem: 'the-attachment',
      }
      const contentCatalog = new ContentCatalog()
      const pageResult = contentCatalog.addFile(new File({ src: pageSrc }))
      expect(pageResult).to.equal(contentCatalog.getById(pageSrc))
      expect(pageResult).to.have.property('out')
      expect(pageResult.out.path).to.equal('the-component/1.2.3/the-page.html')
      expect(pageResult).to.have.property('pub')
      expect(pageResult.pub).to.include({ url: '/the-component/1.2.3/the-page.html' })
      expect(pageResult.src.mediaType).to.equal('text/asciidoc')
      expect(pageResult.mediaType).to.equal('text/asciidoc')
      const attachmentResult = contentCatalog.addFile(new File({ src: attachmentSrc }))
      expect(attachmentResult).to.equal(contentCatalog.getById(attachmentSrc))
      expect(attachmentResult).to.have.property('out')
      expect(attachmentResult.out.path).to.equal('the-component/1.2.3/_attachments/the-attachment.adoc')
      expect(attachmentResult).to.have.property('pub')
      expect(attachmentResult.pub.url).to.equal('/the-component/1.2.3/_attachments/the-attachment.adoc')
      expect(attachmentResult.src.mediaType).to.equal('text/asciidoc')
      expect(attachmentResult.mediaType).to.equal('text/asciidoc')
    })

    it('should not require stem, basename, and mediaType to be set on src object of AsciiDoc file', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile({ src })
      expect(result.mediaType).to.equal('text/asciidoc')
      expect(result.src.mediaType).to.equal('text/asciidoc')
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/1.2.3/the-page.html', rootPath: '../..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/1.2.3/the-page.html', rootPath: '../..' })
    })

    it('should not require stem, basename, and mediaType to be set on src object of non-AsciiDoc file', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'image',
        relative: 'screenshots/add-user.png',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile({ src })
      expect(result.mediaType).to.equal('image/png')
      expect(result.src.mediaType).to.equal('image/png')
      expect(result).to.have.property('out')
      expect(result.out).to.include({
        path: 'the-component/1.2.3/_images/screenshots/add-user.png',
        rootPath: '../../../..',
      })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({
        url: '/the-component/1.2.3/_images/screenshots/add-user.png',
        rootPath: '../../../..',
      })
    })

    it('should allow HTML file to be registered in the page family', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'new-page.html',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile({ src })
      expect(result.mediaType).to.equal('text/html')
      expect(result.src.mediaType).to.equal('text/html')
      expect(result).to.have.property('out')
      expect(result.out).to.include({
        path: 'the-component/1.2.3/new-page.html',
        rootPath: '../..',
      })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({
        url: '/the-component/1.2.3/new-page.html',
        rootPath: '../..',
      })
      expect(result).to.not.have.property('asciidoc')
      expect(contentCatalog.getPages()[0]).to.equal(result)
    })

    it('should not populate out and pub when filename begins with an underscore', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: '_attributes.adoc',
        basename: '_attributes.adoc',
        extname: '.adoc',
        stem: '_attributes',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.not.have.property('out')
      expect(result).to.not.have.property('pub')
    })

    it('should not populate out and pub when file is in directory that begins with an underscore', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: '_attributes/common.adoc',
        basename: '_attributes/common.adoc',
        extname: '.adoc',
        stem: '_attributes/common',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.not.have.property('out')
      expect(result).to.not.have.property('pub')
    })

    it('should not populate out or pub property if out property of file is falsy', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: '_attributes.adoc',
        basename: '_attributes.adoc',
        extname: '.adoc',
        stem: '_attributes',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile(new File({ src, out: undefined }))
      expect(result).to.not.have.property('out')
      expect(result).to.not.have.property('pub')
    })

    it('should respect htmlUrlExtensionStyle setting when computing pub', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const contentCatalog = new ContentCatalog()
      contentCatalog.htmlUrlExtensionStyle = 'indexify'
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/1.2.3/the-page/index.html', rootPath: '../../..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/1.2.3/the-page/', rootPath: '../../..' })
    })

    it('should replace latest version in pub.url and out.path with symbolic name if specified', () => {
      const contentCatalog = new ContentCatalog({ urls: { latestVersionSegment: 'current' } })
      contentCatalog.registerComponentVersion('the-component', '1.2.3', { title: 'The Component' })
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/current/the-page.html', rootPath: '../..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/current/the-page.html', rootPath: '../..' })
    })

    it('should replace latest prerelease in pub.url and out.path with symbolic name if specified', () => {
      const contentCatalog = new ContentCatalog({ urls: { latestPrereleaseVersionSegment: 'next' } })
      contentCatalog.registerComponentVersion('the-component', '1.0.0', { title: 'The Component' })
      contentCatalog.registerComponentVersion('the-component', '2.0.0', { title: 'The Component', prerelease: true })
      const src = {
        component: 'the-component',
        version: '2.0.0',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/next/the-page.html', rootPath: '../..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/next/the-page.html', rootPath: '../..' })
    })

    it('should not introduce version segment in pub.url and out.path when symbolic name is specified if version is master', () => {
      const contentCatalog = new ContentCatalog({ urls: { latestVersionSegment: 'current' } })
      contentCatalog.registerComponentVersion('the-component', 'master', { title: 'The Component' })
      const src = {
        component: 'the-component',
        version: 'master',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/the-page.html', rootPath: '..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/the-page.html', rootPath: '..' })
    })

    it('should not introduce prerelease version segment in pub.url and out.path when symbolic name is specified if version is master', () => {
      const contentCatalog = new ContentCatalog({ urls: { latestPrereleaseVersionSegment: 'unstable' } })
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'The Component' })
      contentCatalog.registerComponentVersion('the-component', 'master', { title: 'The Component', prerelease: true })
      const src = {
        component: 'the-component',
        version: 'master',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/the-page.html', rootPath: '..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/the-page.html', rootPath: '..' })
    })

    it('should not introduce version segment in pub.url and out.path when symbolic name is specified if version is empty', () => {
      const contentCatalog = new ContentCatalog({ urls: { latestVersionSegment: 'current' } })
      contentCatalog.registerComponentVersion('the-component', '', { title: 'The Component' })
      const src = {
        component: 'the-component',
        version: '',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/the-page.html', rootPath: '..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/the-page.html', rootPath: '..' })
    })

    it('should not introduce prerelease version segment in pub.url and out.path when symbolic name is specified if version is empty', () => {
      const contentCatalog = new ContentCatalog({ urls: { latestPrereleaseVersionSegment: 'unstable' } })
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'The Component' })
      contentCatalog.registerComponentVersion('the-component', '', { title: 'The Component', prerelease: true })
      const src = {
        component: 'the-component',
        version: '',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/the-page.html', rootPath: '..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/the-page.html', rootPath: '..' })
    })

    it('should not set out and pub properties if defined on input', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const out = {}
      const pub = {}
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile(new File({ src, out, pub }))
      expect(result).to.have.property('out')
      expect(result.out).to.equal(out)
      expect(result).to.have.property('pub')
      expect(result.pub).to.equal(pub)
    })

    it('should only set pub property on file in navigation family', () => {
      const src = {
        component: 'the-component',
        version: '',
        module: 'ROOT',
        family: 'nav',
        relative: 'nav.adoc',
        basename: 'nav.adoc',
        extname: '.adoc',
        stem: 'nav',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.not.have.property('out')
      expect(result).to.have.property('pub')
      expect(result.pub.url).to.equal('/the-component/')
    })

    it('should set pub property on file in navigation family even if filename begins with underscore', () => {
      const src = {
        component: 'the-component',
        version: '',
        module: 'ROOT',
        family: 'nav',
        relative: 'pages/_nav.adoc',
        basename: '_nav.adoc',
        extname: '.adoc',
        stem: 'pages/_nav',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.not.have.property('out')
      expect(result).to.have.property('pub')
      expect(result.pub.url).to.equal('/the-component/')
    })

    it('should set pub property on file in nav family on ROOT component to / when the HTML URL extension style is indexify', () => {
      const src = {
        component: 'ROOT',
        version: '',
        module: 'ROOT',
        family: 'nav',
        relative: 'nav.adoc',
        basename: 'nav.adoc',
        extname: '.adoc',
        stem: 'nav',
      }
      const contentCatalog = new ContentCatalog({ urls: { htmlExtensionStyle: 'indexify' } })
      const result = contentCatalog.addFile(new File({ src }))
      expect(result).to.not.have.property('out')
      expect(result).to.have.property('pub')
      expect(result.pub.url).to.equal('/')
    })

    it('should convert bare object to vinyl file', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const expectedSrc = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
        mediaType: 'text/asciidoc',
      }
      const contentCatalog = new ContentCatalog()
      const result = contentCatalog.addFile({ path: src.relative, src })
      expect(File.isVinyl(result)).to.be.true()
      expect(result.relative).to.equal('the-page.adoc')
      expect(result.src).to.eql(expectedSrc)
      expect(result).to.have.property('out')
      expect(result).to.have.property('pub')
    })

    it('should process file using family from rel property if set', () => {
      const contentCatalog = new ContentCatalog()
      const relSrc = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-other-page.adoc',
        basename: 'the-other-page.adoc',
        extname: '.adoc',
        stem: 'the-other-page',
      }
      const rel = contentCatalog.addFile(new File({ src: relSrc }))
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'alias',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
      const result = contentCatalog.addFile(new File({ src, rel }))
      expect(result).to.have.property('out')
      expect(result.out).to.include({ path: 'the-component/1.2.3/the-page.html', rootPath: '../..' })
      expect(result).to.have.property('pub')
      expect(result.pub).to.include({ url: '/the-component/1.2.3/the-page.html', rootPath: '../..' })
      expect(result).to.have.property('rel')
      expect(result.rel).to.have.property('pub')
      expect(result.rel.pub).to.include({ url: '/the-component/1.2.3/the-other-page.html', rootPath: '../..' })
    })
  })

  describe('#removeFile()', () => {
    it('should remove file if found in catalog', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const contentCatalog = new ContentCatalog()
      const file = contentCatalog.addFile({ src })
      expect(file).to.be.instanceOf(File)
      expect(file).to.equal(contentCatalog.getById(src))
      expect(contentCatalog.removeFile(file)).to.be.true()
      expect(contentCatalog.getById(src)).to.be.undefined()
    })

    it('should not remove file if not found in catalog', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const contentCatalog = new ContentCatalog()
      const file = contentCatalog.addFile({ src })
      expect(file).to.be.instanceOf(File)
      expect(file).to.equal(contentCatalog.getById(src))
      expect(
        contentCatalog.removeFile({
          src: {
            component: 'the-component',
            version: '1.2.3',
            module: 'ROOT',
            family: 'page',
            relative: 'the-page-2.adoc',
          },
        })
      ).to.be.false()
    })

    it('should not remove file if family is not yet known by catalog', () => {
      const src = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const contentCatalog = new ContentCatalog()
      contentCatalog.addFile({ src })
      expect(
        contentCatalog.removeFile({
          src: {
            component: 'the-component',
            version: '1.2.3',
            module: 'ROOT',
            family: 'example',
            relative: 'config.yml',
          },
        })
      ).to.be.false()
    })
  })

  describe('#registerPageAlias()', () => {
    let contentCatalog
    let targetPageSrc

    beforeEach(() => {
      contentCatalog = new ContentCatalog()
      contentCatalog.registerComponentVersion('the-component', '1.2.3', { title: 'The Component' })
      targetPageSrc = {
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        basename: 'the-page.adoc',
        extname: '.adoc',
        stem: 'the-page',
      }
    })

    // QUESTION should this case throw an error or warning?
    it('should not register alias if page spec is invalid', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      expect(contentCatalog.registerPageAlias('the-component::', targetPage)).to.be.undefined()
    })

    it('should register an alias for target file given a valid qualified page spec', () => {
      contentCatalog.registerComponentVersion('the-component', '1.0.0', { title: 'The Component' })
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('1.0.0@the-component::the-topic/alias.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'the-component',
        version: '1.0.0',
        module: 'ROOT',
        family: 'alias',
        relative: 'the-topic/alias.adoc',
        basename: 'alias.adoc',
        extname: '.adoc',
        stem: 'alias',
      })
      expect(result.path).to.equal(targetPage.path)
      expect(result).to.have.property('rel')
      expect(result.rel).to.equal(targetPage)
      expect(targetPage.rel).to.equal(result)
      expect(contentCatalog.getById(result.src)).to.equal(result)
    })

    it('should register an alias for target file given a valid contextual page spec', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('alias.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'alias',
        relative: 'alias.adoc',
      })
      expect(result.path).to.equal(targetPage.path)
      expect(result.mediaType).to.equal('text/html')
      expect(result.src.mediaType).to.equal('text/asciidoc')
      expect(result).to.have.property('rel')
      expect(result.rel).to.equal(targetPage)
      expect(contentCatalog.getById(result.src)).to.equal(result)
    })

    it('should store alias in alias family in content catalog', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('alias.adoc', targetPage)
      expect(result).to.have.property('rel')
      expect(result.rel).to.equal(targetPage)
      expect(contentCatalog.getById(result.src)).to.equal(result)
      const aliases = contentCatalog.findBy({ family: 'alias' })
      expect(aliases).to.have.lengthOf(1)
      expect(aliases[0]).to.equal(result)
    })

    it('should register alias if relative path in page spec is only a file extension', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('ROOT:.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src.relative).to.equal('.adoc')
    })

    it('should register different aliases for the same page', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result1 = contentCatalog.registerPageAlias('alias.adoc', targetPage)
      const result2 = contentCatalog.registerPageAlias('old-module:folder/alias.adoc', targetPage)
      expect(result1).to.exist()
      expect(result1).to.have.property('src')
      expect(result1.src).to.include({
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'alias',
        relative: 'alias.adoc',
      })
      expect(result1.path).to.equal(targetPage.path)
      expect(result1.mediaType).to.equal('text/html')
      expect(result1.src.mediaType).to.equal('text/asciidoc')
      expect(result1).to.have.property('rel')
      expect(result1.rel).to.equal(targetPage)
      expect(contentCatalog.getById(result1.src)).to.equal(result1)
      expect(result2).to.exist()
      expect(result2).to.have.property('src')
      expect(result2.src).to.include({
        component: 'the-component',
        version: '1.2.3',
        module: 'old-module',
        family: 'alias',
        relative: 'folder/alias.adoc',
      })
      expect(result2.path).to.equal(targetPage.path)
      expect(result2.mediaType).to.equal('text/html')
      expect(result2.src.mediaType).to.equal('text/asciidoc')
      expect(result2).to.have.property('rel')
      expect(result2.rel).to.equal(targetPage)
      expect(contentCatalog.getById(result2.src)).to.equal(result2)
      // NOTE: rel on target page is reference to primary alias
      expect(targetPage.rel).to.equal(result1)
    })

    it('should set version of alias to latest version of component if version not specified', () => {
      contentCatalog.registerComponentVersion('other-component', '1.0', { title: 'Other Component' })
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('other-component::alias.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'other-component',
        version: '1.0',
        module: 'ROOT',
        family: 'alias',
        relative: 'alias.adoc',
      })
    })

    it('should register alias if component does not exist', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('1.0@unknown-component::alias.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'unknown-component',
        version: '1.0',
        module: 'ROOT',
        family: 'alias',
        relative: 'alias.adoc',
      })
    })

    it('should register alias if version does not exist', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('1.0@alias.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'the-component',
        version: '1.0',
        module: 'ROOT',
        family: 'alias',
        relative: 'alias.adoc',
      })
    })

    it('should add .adoc file extension to alias when registering if no file extension specified', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('mod:topic/alias', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'the-component',
        version: '1.2.3',
        module: 'mod',
        family: 'alias',
        relative: 'topic/alias.adoc',
        basename: 'alias.adoc',
        extname: '.adoc',
        stem: 'alias',
      })
    })

    it('should register alias in versionless version if component does not exist and version is not specified', () => {
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('unknown-component::alias.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'unknown-component',
        version: '',
        module: 'ROOT',
        family: 'alias',
        relative: 'alias.adoc',
      })
    })

    it('should not permit alias to be registered that matches target page', () => {
      targetPageSrc.origin = { url: 'https://githost/repo.git', startPath: '', branch: 'v1.2.3', refname: 'v1.2.3' }
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      targetPage.path = `modules/${targetPageSrc.module}/pages/${targetPageSrc.relative}`
      const aliasSpec = targetPageSrc.relative
      const expectedError =
        'Page cannot define alias that references itself: 1.2.3@the-component::the-page.adoc' +
        ` (specified as: ${aliasSpec})\n` +
        '    source: modules/ROOT/pages/the-page.adoc in https://githost/repo.git (branch: v1.2.3)'
      expect(() => contentCatalog.registerPageAlias(aliasSpec, targetPage)).to.throw(expectedError)
    })

    it('should not allow self reference to be used in page alias', () => {
      targetPageSrc.origin = { url: 'https://githost/repo.git', startPath: '', branch: 'v1.2.3', refname: 'v1.2.3' }
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      targetPage.path = `modules/${targetPageSrc.module}/pages/${targetPageSrc.relative}`
      const aliasSpec = './' + targetPageSrc.relative
      const expectedError =
        'Page cannot define alias that references itself: 1.2.3@the-component::the-page.adoc' +
        ` (specified as: ${aliasSpec})\n` +
        '    source: modules/ROOT/pages/the-page.adoc in https://githost/repo.git (branch: v1.2.3)'
      expect(() => contentCatalog.registerPageAlias(aliasSpec, targetPage)).to.throw(expectedError)
    })

    it('should not allow parent reference to be used in page alias', () => {
      targetPageSrc.origin = { url: 'https://githost/repo.git', startPath: '', branch: 'v1.2.3', refname: 'v1.2.3' }
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      targetPage.path = `modules/${targetPageSrc.module}/pages/${targetPageSrc.relative}`
      const aliasSpec = '../' + targetPageSrc.relative
      const expectedError =
        'Page cannot define alias that references itself: 1.2.3@the-component::the-page.adoc' +
        ` (specified as: ${aliasSpec})\n` +
        '    source: modules/ROOT/pages/the-page.adoc in https://githost/repo.git (branch: v1.2.3)'
      expect(() => contentCatalog.registerPageAlias(aliasSpec, targetPage)).to.throw(expectedError)
    })

    it('should not allow alias to be registered that matches existing page', () => {
      targetPageSrc.origin = { url: 'https://githost/repo.git', startPath: '', branch: 'v1.2.3', refname: 'v1.2.3' }
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      targetPage.path = `modules/${targetPageSrc.module}/pages/${targetPageSrc.relative}`
      const existingPageSrc = { ...targetPageSrc }
      existingPageSrc.relative = existingPageSrc.basename = 'the-existing-page.adoc'
      const existingPage = contentCatalog.addFile(new File({ src: existingPageSrc }))
      existingPage.path = `modules/${existingPageSrc.module}/pages/${existingPageSrc.relative}`
      const aliasSpec = existingPageSrc.relative
      const expectedError =
        'Page alias cannot reference an existing page: 1.2.3@the-component::the-existing-page.adoc' +
        ` (specified as: ${aliasSpec})\n` +
        '    source: modules/ROOT/pages/the-page.adoc in https://githost/repo.git (branch: v1.2.3)\n' +
        '    existing page: modules/ROOT/pages/the-existing-page.adoc in https://githost/repo.git (branch: v1.2.3)'
      expect(() => contentCatalog.registerPageAlias(aliasSpec, targetPage)).to.throw(expectedError)
    })

    it('should not allow alias to be registered multiple times', () => {
      targetPageSrc.origin = { url: 'https://githost/repo.git', startPath: '', branch: 'v1.2.3', refname: 'v1.2.3' }
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      targetPage.path = `modules/${targetPageSrc.module}/pages/${targetPageSrc.relative}`
      const expectedError =
        'Duplicate alias: 1.2.3@the-component::alias.adoc (specified as: ROOT:alias.adoc)\n' +
        '    source: modules/ROOT/pages/the-page.adoc in https://githost/repo.git (branch: v1.2.3)'
      expect(() => contentCatalog.registerPageAlias('alias.adoc', targetPage)).to.not.throw()
      expect(() => contentCatalog.registerPageAlias('ROOT:alias.adoc', targetPage)).to.throw(expectedError)
    })

    it('should not allow alias for page in unknown component to be registered multiple times', () => {
      targetPageSrc.origin = { url: 'https://githost/repo.git', startPath: '', branch: 'v1.2.3', refname: 'v1.2.3' }
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      targetPage.path = `modules/${targetPageSrc.module}/pages/${targetPageSrc.relative}`
      const expectedError =
        'Duplicate alias: next@unknown::alias.adoc (specified as: next@unknown:ROOT:alias.adoc)\n' +
        '    source: modules/ROOT/pages/the-page.adoc in https://githost/repo.git (branch: v1.2.3)'
      expect(() => contentCatalog.registerPageAlias('next@unknown::alias.adoc', targetPage)).to.not.throw()
      expect(() => contentCatalog.registerPageAlias('next@unknown:ROOT:alias.adoc', targetPage)).to.throw(expectedError)
    })

    it('should register an alias correctly when the HTML URL extension style is indexify', () => {
      contentCatalog = new ContentCatalog({ urls: { htmlExtensionStyle: 'indexify' } })
      contentCatalog.registerComponentVersion('the-component', '1.2.3', { title: 'The Component' })
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('alias.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'alias',
        relative: 'alias.adoc',
      })
      expect(result.out.path).to.equal('the-component/1.2.3/alias/index.html')
      expect(result.pub.url).to.equal('/the-component/1.2.3/alias/')
    })

    it('should register an alias correctly when the HTML URL extension style is drop', () => {
      contentCatalog = new ContentCatalog({ urls: { htmlExtensionStyle: 'drop' } })
      contentCatalog.registerComponentVersion('the-component', '1.2.3', { title: 'The Component' })
      const targetPage = contentCatalog.addFile(new File({ src: targetPageSrc }))
      const result = contentCatalog.registerPageAlias('alias.adoc', targetPage)
      expect(result).to.exist()
      expect(result).to.have.property('src')
      expect(result.src).to.include({
        component: 'the-component',
        version: '1.2.3',
        module: 'ROOT',
        family: 'alias',
        relative: 'alias.adoc',
      })
      expect(result.out.path).to.equal('the-component/1.2.3/alias.html')
      expect(result.pub.url).to.equal('/the-component/1.2.3/alias')
    })
  })

  describe('#resolvePage()', () => {
    beforeEach(() => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          files: [createFile('modules/ROOT/assets/images/foo.png'), createFile('modules/ROOT/pages/page-one.adoc')],
        },
      ]
    })

    it('should find file by qualified page spec', () => {
      const pageSpec = 'v1.2.3@the-component:ROOT:page-one.adoc'
      const page = classifyContent(playbook, aggregate).resolvePage(pageSpec)
      expect(page.path).to.equal('modules/ROOT/pages/page-one.adoc')
    })

    it('should return undefined if file not resolved from qualified page spec', () => {
      const pageSpec = 'v1.2.3@the-component:ROOT:no-such-page.adoc'
      const page = classifyContent(playbook, aggregate).resolvePage(pageSpec)
      expect(page).to.not.exist()
    })

    it('should find file by contextual page spec', () => {
      const pageSpec = 'ROOT:page-one.adoc'
      const context = { component: 'the-component', version: 'v1.2.3' }
      const page = classifyContent(playbook, aggregate).resolvePage(pageSpec, context)
      expect(page.path).to.equal('modules/ROOT/pages/page-one.adoc')
    })

    it('should return undefined if file not resolved from contextual page spec', () => {
      const pageSpec = 'ROOT:page-one.adoc'
      const context = {}
      const page = classifyContent(playbook, aggregate).resolvePage(pageSpec, context)
      expect(page).to.not.exist()
    })

    it('should dereference alias in order to resolve page', () => {
      const contentCatalog = classifyContent(playbook, aggregate)
      const targetPage = contentCatalog.resolvePage('v1.2.3@the-component::page-one.adoc')
      contentCatalog.registerPageAlias('alias.adoc', targetPage)
      const pageResolvedFromAlias = contentCatalog.resolvePage('v1.2.3@the-component::alias.adoc')
      expect(pageResolvedFromAlias).to.exist()
      expect(pageResolvedFromAlias).to.equal(targetPage)
    })
  })

  describe('#resolveResource()', () => {
    beforeEach(() => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          files: [createFile('modules/ROOT/assets/images/foo.png'), createFile('modules/ROOT/pages/page-one.adoc')],
        },
      ]
    })

    it('should find file by qualified resource spec', () => {
      const pageSpec = 'v1.2.3@the-component:ROOT:image$foo.png'
      const page = classifyContent(playbook, aggregate).resolveResource(pageSpec)
      expect(page.path).to.equal('modules/ROOT/assets/images/foo.png')
    })
  })

  describe('#getById()', () => {
    beforeEach(() => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          files: [createFile('modules/ROOT/assets/images/foo.png'), createFile('modules/ROOT/pages/page-one.adoc')],
        },
      ]
    })

    it('should find file by ID', () => {
      const page = classifyContent(playbook, aggregate).getById({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'page-one.adoc',
      })
      expect(page.path).to.equal('modules/ROOT/pages/page-one.adoc')
    })

    it('should return undefined if ID is not found', () => {
      const page = classifyContent(playbook, aggregate).getById({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'unknown-page.adoc',
      })
      expect(page).to.not.exist()
    })
  })

  describe('#getByPath()', () => {
    beforeEach(() => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          files: [createFile('modules/ROOT/pages/_partials/tables/options.adoc')],
        },
      ]
    })

    it('should find file by path', () => {
      const page = classifyContent(playbook, aggregate).getByPath({
        component: 'the-component',
        version: 'v1.2.3',
        path: 'modules/ROOT/pages/_partials/tables/options.adoc',
      })
      expect(page.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'partial',
        relative: 'tables/options.adoc',
      })
    })

    it('should return undefined if path is not found', () => {
      const page = classifyContent(playbook, aggregate).getByPath({
        component: 'the-component',
        version: 'v1.2.3',
        path: 'modules/ROOT/pages/_partials/does-not-exist.adoc',
      })
      expect(page).to.not.exist()
    })
  })

  describe('#getSiteStartPage()', () => {
    let contentCatalog

    beforeEach(() => {
      contentCatalog = new ContentCatalog()
      contentCatalog.getById = spy(contentCatalog.getById)
    })

    it('should return undefined if site start page does not exist in catalog', () => {
      expect(contentCatalog.getSiteStartPage()).to.not.exist()
      expect(contentCatalog.getById).to.have.been.called.with(ROOT_INDEX_PAGE_ID)
    })

    it('should return site start page if stored as a concrete page', () => {
      const pageSrc = { ...ROOT_INDEX_PAGE_ID }
      const expectedSrc = { ...pageSrc, basename: 'index.adoc', extname: '.adoc', stem: 'index' }
      contentCatalog.addFile({
        contents: Buffer.from('I am your home base!'),
        src: pageSrc,
      })
      const result = contentCatalog.getSiteStartPage()
      expect(contentCatalog.getById).to.have.been.called.with(ROOT_INDEX_PAGE_ID)
      expect(result).to.exist()
      expect(result.src).to.include(expectedSrc)
      expect(result.contents.toString()).to.equal('I am your home base!')
    })

    it('should return reference for site start page stored as an alias', () => {
      const thePageId = {
        component: 'the-component',
        version: '1.0.1',
        module: 'ROOT',
        family: 'page',
        relative: 'home.adoc',
      }
      const expectedPageSrc = {
        ...thePageId,
        basename: 'home.adoc',
        extname: '.adoc',
        stem: 'home',
        mediaType: 'text/asciidoc',
      }
      contentCatalog.addFile({
        contents: Buffer.from('I am your home base!'),
        src: thePageId,
      })
      contentCatalog.addFile({
        src: { ...ROOT_INDEX_PAGE_ID, family: 'alias' },
        rel: contentCatalog.getById(thePageId),
      })
      contentCatalog.getById = spy(contentCatalog.getById)
      const result = contentCatalog.getSiteStartPage()
      expect(contentCatalog.getById).on.nth(1).called.with(ROOT_INDEX_PAGE_ID)
      expect(contentCatalog.getById)
        .on.nth(2)
        .called.with({ ...ROOT_INDEX_PAGE_ID, family: 'alias' })
      expect(result).to.exist()
      expect(result.src).to.eql(expectedPageSrc)
      expect(result.contents.toString()).to.equal('I am your home base!')
    })
  })

  describe('#registerSiteStartPage()', () => {
    let contentCatalog

    beforeEach(() => {
      contentCatalog = new ContentCatalog()
    })

    it('should not register site start page alias if page already exists at that location', () => {
      const pageSrc = { ...ROOT_INDEX_PAGE_ID }
      const pageContents = Buffer.from('I am your home base!')
      contentCatalog.addFile({ contents: pageContents, src: pageSrc })
      const startPage = contentCatalog.registerSiteStartPage('ROOT::index.adoc')
      expect(startPage).to.not.exist()
      const files = contentCatalog.getFiles()
      expect(files).to.have.lengthOf(1)
      expect(files[0].src.family).to.equal('page')
      expect(files[0].contents).to.equal(pageContents)
    })

    it('should not register site start page alias that redirects to itself', () => {
      ;['default', 'indexify', 'drop'].forEach((htmlExtensionStyle) => {
        contentCatalog = new ContentCatalog({ urls: { latestVersionSegment: '', htmlExtensionStyle } })
        contentCatalog.registerComponentVersion('ROOT', '6.0', { title: 'Home' })
        contentCatalog.addFile({
          contents: Buffer.from('= Home\n\nI am your home base!'),
          src: {
            component: 'ROOT',
            version: '6.0',
            module: 'ROOT',
            family: 'page',
            relative: 'index.adoc',
          },
        })
        contentCatalog.registerComponentVersionStartPage('ROOT', '6.0')
        const startPage = contentCatalog.registerSiteStartPage('ROOT::index.adoc')
        expect(startPage).to.be.undefined()
        const files = contentCatalog.getFiles()
        expect(files).to.have.lengthOf(1)
        expect(contentCatalog.getSiteStartPage()).to.be.undefined()
      })
    })

    it('should return page registered as site start page', () => {
      const thePageId = {
        component: 'the-component',
        version: '3.0',
        module: 'ROOT',
        family: 'page',
        relative: 'start.adoc',
      }
      const pageContents = Buffer.from('I am your home base!')
      contentCatalog.addFile({ contents: pageContents, src: thePageId })
      contentCatalog.registerComponentVersion('the-component', '3.0', { title: 'The Component' })
      const startPageAlias = contentCatalog.registerSiteStartPage('the-component::start.adoc')
      expect(startPageAlias).to.exist()
      expect(startPageAlias.src.family).to.equal('alias')
      expect(startPageAlias).to.have.property('synthetic', true)
      const startPage = contentCatalog.getSiteStartPage()
      expect(startPage.src).to.include(thePageId)
      expect(startPage.contents).to.equal(pageContents)
    })

    it('should register site start page over synthetic component version start page', () => {
      const name = 'ROOT'
      const version = ''
      const contentCatalog = new ContentCatalog()
      const componentVersion = contentCatalog.registerComponentVersion(name, version)
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'start.adoc',
        },
      })
      contentCatalog.addFile({
        src: {
          component: name,
          version,
          module: 'ROOT',
          family: 'page',
          relative: 'new-start.adoc',
        },
      })
      contentCatalog.registerComponentVersionStartPage(name, componentVersion, 'start.adoc')
      expect(
        contentCatalog.getById({
          component: name,
          version,
          module: 'ROOT',
          family: 'alias',
          relative: 'index.adoc',
        })
      ).to.have.nested.property('rel.src.relative', 'start.adoc')
      contentCatalog.registerSiteStartPage('ROOT::new-start.adoc')
      expect(
        contentCatalog.getById({
          component: name,
          version,
          module: 'ROOT',
          family: 'alias',
          relative: 'index.adoc',
        })
      ).to.have.nested.property('rel.src.relative', 'new-start.adoc')
    })
  })

  describe('#exportToModel()', () => {
    it('should export public API that delegates to real instance', () => {
      const src = {
        component: 'the-component',
        version: '1.0',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }
      const contentCatalog = new ContentCatalog()
      contentCatalog.addFile({ src })
      contentCatalog.registerComponentVersion('the-component', '1.0', { title: 'The Component' })
      const expectedMethods = [
        'findBy',
        'getAll', // @deprecated; scheduled to be removed in Antora 4
        'getById',
        'getComponent',
        'getComponentVersion',
        'getComponents',
        'getComponentsSortedBy',
        'getFiles',
        'getPages',
        'getSiteStartPage',
        'resolvePage',
        'resolveResource',
      ]
      const model = contentCatalog.exportToModel()
      expect(model).to.not.equal(contentCatalog)
      expectedMethods.forEach((method) => {
        expect(model).to.have.property(method).that.is.a('function')
      })
      expect(model.getComponents()).to.have.lengthOf(1)
      const component = model.getComponent('the-component')
      expect(component).to.exist()
      expect(component.name).to.equal('the-component')
      const componentVersion = model.getComponentVersion(component, '1.0')
      expect(componentVersion).to.exist()
      expect(componentVersion.version).to.equal('1.0')
      let pages = model.getPages()
      expect(pages).to.have.lengthOf(1)
      expect(pages[0].src.relative).to.equal('the-page.adoc')
      pages = model.findBy({ family: 'page', component: 'the-component' })
      expect(pages).to.have.lengthOf(1)
      expect(pages[0].src.relative).to.equal('the-page.adoc')
      let page = model.getById(src)
      expect(page).to.exist()
      expect(page.src.relative).to.equal('the-page.adoc')
      page = model.resolvePage('the-component::the-page.adoc')
      expect(page).to.exist()
      expect(page.src.relative).to.equal('the-page.adoc')
    })
  })
})

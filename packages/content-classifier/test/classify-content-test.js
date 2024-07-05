/* eslint-env mocha */
'use strict'

const { captureLogSync, expect } = require('@antora/test-harness')

const classifyContent = require('@antora/content-classifier')
const { posix: path } = require('path')

const COMPONENT_DESC_FILENAME = 'antora.yml'

describe('classifyContent()', () => {
  let playbook
  let aggregate

  const createFile = (path_) => {
    const basename = path.basename(path_)
    const extname = path.extname(path_)
    const stem = path.basename(path_, extname)
    const origin = { url: 'https://githost/repo.git', startPath: '', branch: 'v1.2.3', refname: 'v1.2.3' }
    return {
      path: path_,
      src: { basename, stem, extname, origin },
    }
  }

  beforeEach(() => {
    playbook = {
      site: {},
      urls: { htmlExtensionStyle: 'default' },
    }
    aggregate = [
      {
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
        files: [],
      },
    ]
  })

  describe('initialize content catalog', () => {
    it('should initialize url options on ContentCatalog to default values', () => {
      delete playbook.urls
      const contentCatalog = classifyContent(playbook, aggregate)
      expect(contentCatalog.htmlUrlExtensionStyle).to.equal('default')
      expect(contentCatalog.urlRedirectFacility).to.equal('static')
      expect(contentCatalog.latestVersionUrlStrategy).to.be.undefined()
      expect(contentCatalog.latestVersionUrlSegment).to.be.undefined()
      expect(contentCatalog.latestPrereleaseVersionUrlSegment).to.be.undefined()
    })

    it('should set url options on ContentCatalog from playbook', () => {
      playbook.urls.htmlExtensionStyle = 'indexify'
      playbook.urls.redirectFacility = 'nginx'
      playbook.urls.latestVersionSegment = 'latest'
      const contentCatalog = classifyContent(playbook, aggregate)
      expect(contentCatalog.htmlUrlExtensionStyle).to.equal('indexify')
      expect(contentCatalog.urlRedirectFacility).to.equal('nginx')
      expect(contentCatalog.latestVersionUrlSegmentStrategy).to.equal('replace')
      expect(contentCatalog.latestVersionUrlSegment).to.equal('latest')
      expect(contentCatalog.latestPrereleaseVersionUrlSegment).to.be.undefined()
    })

    it('should unset latest version segment properties if only strategy is set', () => {
      playbook.urls.latestVersionSegmentStrategy = 'replace'
      const contentCatalog = classifyContent(playbook, aggregate)
      expect(contentCatalog.latestVersionUrlSegmentStrategy).to.be.undefined()
      expect(contentCatalog.latestVersionUrlSegment).to.be.undefined()
      expect(contentCatalog.latestPrereleaseVersionUrlSegment).to.be.undefined()
    })

    it('should unset latest version segment properties if strategy is redirect:from and segments are empty', () => {
      playbook.urls.latestVersionSegmentStrategy = 'redirect:from'
      playbook.urls.latestVersionSegment = ''
      playbook.urls.latestPrereleaseVersionSegment = ''
      const contentCatalog = classifyContent(playbook, aggregate)
      expect(contentCatalog.latestVersionUrlSegmentStrategy).to.be.undefined()
      expect(contentCatalog.latestVersionUrlSegment).to.be.undefined()
      expect(contentCatalog.latestPrereleaseVersionUrlSegment).to.be.undefined()
    })

    it('should be able to set latest prerelease version segment without setting latest version segment', () => {
      playbook.urls.latestPrereleaseVersionSegment = 'next'
      const contentCatalog = classifyContent(playbook, aggregate)
      expect(contentCatalog.latestVersionUrlSegmentStrategy).to.equal('replace')
      expect(contentCatalog.latestVersionUrlSegment).to.be.undefined()
      expect(contentCatalog.latestPrereleaseVersionUrlSegment).to.equal('next')
    })
  })

  describe('register components', () => {
    it('should register all components', () => {
      aggregate.push({
        name: 'another-component',
        title: 'Another Component',
        version: 'v1.0.0',
        files: [],
      })
      const contentCatalog = classifyContent(playbook, aggregate)
      const components = contentCatalog.getComponents()
      expect(components).to.have.lengthOf(2)
      const names = components.map((component) => component.name)
      expect(names).to.have.members(['the-component', 'another-component'])
    })

    it('should register all versions of a component in sorted order', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v1',
        files: [],
      })
      aggregate.push({
        name: 'another-component',
        title: 'Another Component',
        version: 'v1.0.0',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v2.0.0',
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.name).to.equal('the-component')
      const versions = component.versions.map((version) => version.version)
      expect(versions).to.eql(['v2.0.0', 'v1.2.3', 'v1'])
    })

    it('should register all versions of a component in sorted order when versions are not semantic', () => {
      aggregate = []
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'rev3',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'rev1',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'rev2',
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.name).to.equal('the-component')
      const versions = component.versions.map((version) => version.version)
      expect(versions).to.eql(['rev3', 'rev2', 'rev1'])
    })

    it('should sort non-semantic version before semantic versions', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v1.3.0',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'edge',
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.name).to.equal('the-component')
      const versions = component.versions.map((version) => version.version)
      expect(versions).to.eql(['edge', 'v1.3.0', 'v1.2.3'])
    })

    it('should sort non-semantic prerelease version before semantic versions', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v1.3.0',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'nightly',
        prerelease: true,
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.name).to.equal('the-component')
      const versions = component.versions.map((version) => version.version)
      expect(versions).to.eql(['nightly', 'v1.3.0', 'v1.2.3'])
    })

    it('should sort multiple non-semantic versions in reverse alphabetical order before semantic versions', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'beta',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'canary',
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.name).to.equal('the-component')
      const versions = component.versions.map((version) => version.version)
      expect(versions).to.eql(['canary', 'beta', 'v1.2.3'])
    })

    it('should sort non-semantic prerelease versions before non-semantic stable versions', () => {
      aggregate.length = 0
      ;['f36', 'f35', 'f34', 'rawhide'].forEach((version) => {
        aggregate.push({
          name: 'the-component',
          title: 'The Component',
          version,
          prerelease: version.charAt() !== 'f',
          files: [],
        })
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      const versions = component.versions.map(({ version }) => version)
      expect(versions).to.eql(['rawhide', 'f36', 'f35', 'f34'])
    })

    it('should promote non-semantic prerelease versions before non-semantic stable versions', () => {
      aggregate.length = 0
      ;['f36', 'f35', 'f34', 'edge'].forEach((version) => {
        aggregate.push({
          name: 'the-component',
          title: 'The Component',
          version,
          prerelease: version.charAt() !== 'f',
          files: [],
        })
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      const versions = component.versions.map(({ version }) => version)
      expect(versions).to.eql(['edge', 'f36', 'f35', 'f34'])
    })

    it('should sort non-semantic versions before semantic stable versions', () => {
      ;['f36', 'f35', 'f34'].forEach((version) => {
        aggregate.push({
          name: 'the-component',
          title: 'The Component',
          version,
          files: [],
        })
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      const versions = component.versions.map(({ version }) => version)
      expect(versions).to.eql(['f36', 'f35', 'f34', 'v1.2.3'])
    })

    it('should group non-semantic versions by prerelease status', () => {
      aggregate.length = 0
      ;['feisty', 'zany', 'zesty', 'breezy', 'contrary'].forEach((version) => {
        aggregate.push({
          name: 'the-component',
          title: 'The Component',
          version,
          prerelease: version === 'zany' || version === 'contrary',
          files: [],
        })
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      const versions = component.versions.map(({ version }) => version)
      expect(versions).to.eql(['zany', 'contrary', 'zesty', 'feisty', 'breezy'])
      expect(component.latest.version).to.eql('zesty')
      expect(component.latestPrerelease.version).to.eql('zany')
    })

    it('should sort semantic prerelease below non-semantic stable release', () => {
      ;[
        ['3.1.0-SNAPSHOT', 'stable', '3.0.0', '3.0.0-M1'],
        ['stable', '3.1.0-SNAPSHOT', '3.0.0-M1', '3.0.0'],
      ].forEach((permutation) => {
        aggregate.length = 0
        permutation.forEach((version) => {
          aggregate.push({
            name: 'the-component',
            title: 'The Component',
            version,
            prerelease: ~version.indexOf('-'),
            files: [],
          })
        })
        const component = classifyContent(playbook, aggregate).getComponent('the-component')
        const versions = component.versions.map(({ version }) => version)
        expect(versions).to.eql(['stable', '3.1.0-SNAPSHOT', '3.0.0', '3.0.0-M1'])
        expect(component.latest.version).to.eql('stable')
        expect(component.latestPrerelease).to.be.undefined()
      })
    })

    it('should sort semantic prerelease below non-semantic stable release that follows non-semantic prerelease', () => {
      ;[
        ['3.1.0-SNAPSHOT', 'edge', 'stable', '2.1.0', '3.0.0', '2.2.0-SNAPSHOT'],
        ['stable', '3.1.0-SNAPSHOT', 'edge', '2.1.0', '3.0.0', '2.2.0-SNAPSHOT'],
      ].forEach((permutation) => {
        aggregate.length = 0
        permutation.forEach((version) => {
          aggregate.push({
            name: 'the-component',
            title: 'The Component',
            version,
            prerelease: version === 'edge' || ~version.indexOf('-'),
            files: [],
          })
        })
        const component = classifyContent(playbook, aggregate).getComponent('the-component')
        const versions = component.versions.map(({ version }) => version)
        expect(versions).to.eql(['edge', 'stable', '3.1.0-SNAPSHOT', '3.0.0', '2.2.0-SNAPSHOT', '2.1.0'])
        expect(component.latest.version).to.eql('stable')
        expect(component.latestPrerelease.version).to.eql('edge')
      })
    })

    it('should insert prerelease component version for older release line in sequence', () => {
      ;['5.7.1', '5.8.1-SNAPSHOT', '5.8.0', '5.7.2-SNAPSHOT', '5.6.6', '6.0.0-SNAPSHOT'].forEach((entry) => {
        const [version, prerelease] = entry.split('-')
        aggregate.push({
          name: 'the-component',
          title: 'The Component',
          version,
          prerelease,
          files: [],
        })
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      const versions = component.versions.map(({ version }) => version)
      expect(versions).to.eql(['6.0.0', '5.8.1', '5.8.0', '5.7.2', '5.7.1', '5.6.6', 'v1.2.3'])
      expect(component.latest.version).to.eql('5.8.0')
      expect(component.latestPrerelease.version).to.eql('6.0.0')
    })

    it('should not flag older prerelease as the latest prerelease', () => {
      ;['5.8.0', '5.6.6', '5.7.2-SNAPSHOT', '5.7.1'].forEach((entry) => {
        const [version, prerelease] = entry.split('-')
        aggregate.push({
          name: 'the-component',
          title: 'The Component',
          version,
          prerelease,
          files: [],
        })
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      const versions = component.versions.map(({ version }) => version)
      expect(versions).to.eql(['5.8.0', '5.7.2', '5.7.1', '5.6.6', 'v1.2.3'])
      expect(component.latest.version).to.eql('5.8.0')
      expect(component.latestPrerelease).to.be.undefined()
    })

    it('should insert versionless version first if there are no prereleases', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'dev',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: '',
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.name).to.equal('the-component')
      const versions = component.versions.map((version) => version.version)
      expect(versions).to.eql(['', 'dev', 'v1.2.3'])
    })

    it('should insert versionless component version after last prerelease', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v2.0',
        prerelease: true,
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: '',
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      const versions = component.versions.map(({ version }) => version)
      expect(versions).to.eql(['v2.0', '', 'v1.2.3'])
    })

    it('should insert prerelease versionless component version before other prereleases', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v2.0',
        prerelease: true,
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: '',
        prerelease: true,
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      const versions = component.versions.map(({ version }) => version)
      expect(versions).to.eql(['', 'v2.0', 'v1.2.3'])
    })

    it('should use name as title if title is falsy', () => {
      aggregate[0].title = undefined
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.title).to.equal(component.name)
    })

    it('should update title for component to match title of latest version', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component (Newest)',
        version: 'v2.0.0',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component (Patch)',
        version: 'v1.2.4',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component (Oldest)',
        version: 'v1.0.0',
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.title).to.equal('The Component (Newest)')
      expect(component.versions[0].title).to.equal('The Component (Newest)')
      expect(component.versions[1].title).to.equal('The Component (Patch)')
    })

    it('should update url for component to match url of latest version', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component (Newest)',
        version: 'v2.0.0',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component (Patch)',
        version: 'v1.2.4',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component (Oldest)',
        version: 'v1.0.0',
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.url).to.equal('/the-component/v2.0.0/index.html')
    })

    it('should update asciidoc for component to match asciidoc of latest version', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v2.0.0',
        asciidoc: { attributes: { modifier: 'newest' } },
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.4',
        asciidoc: { attributes: { modifier: 'patch' } },
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v1.0.0',
        asciidoc: { attributes: { modifier: 'oldest' } },
        files: [],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.asciidoc.attributes).to.have.property('modifier', 'newest')
    })

    it('should configure latest property to resolve to latest version', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v2.0.0',
        files: [],
      })
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v1.0.0',
        files: [],
      })
      const catalog = classifyContent(playbook, aggregate)
      const component = catalog.getComponent('the-component')
      expect(component).to.exist()
      expect(component.latest).to.exist()
      expect(component.latest.version).to.equal('v2.0.0')
      catalog.registerComponentVersion('the-component', 'v3.0.0')
      expect(component.latest.version).to.equal('v3.0.0')
    })

    it('should use version as display version by default', () => {
      const catalog = classifyContent(playbook, aggregate)
      const componentVersion = catalog.getComponentVersion('the-component', 'v1.2.3')
      expect(componentVersion).to.exist()
      expect(componentVersion.displayVersion).to.equal(componentVersion.version)
    })

    it('should use "default" as fallback display version for versionless version', () => {
      aggregate[0].version = ''
      const catalog = classifyContent(playbook, aggregate)
      const componentVersion = catalog.getComponentVersion('the-component', '')
      expect(componentVersion).to.exist()
      expect(componentVersion.displayVersion).to.equal('default')
    })

    it('should use prerelease string as display version fallback if value is a string and version is empty', () => {
      aggregate[0].prerelease = 'dev'
      aggregate[0].version = ''
      const catalog = classifyContent(playbook, aggregate)
      const componentVersion = catalog.getComponentVersion('the-component', '')
      expect(componentVersion).to.exist()
      expect(componentVersion.version).to.equal('')
      expect(componentVersion.displayVersion).to.equal('dev')
    })

    it('should compute display version from version and prerelease if prerelease is set', () => {
      aggregate[0].prerelease = 'Beta.1'
      const catalog = classifyContent(playbook, aggregate)
      const componentVersion = catalog.getComponentVersion('the-component', 'v1.2.3')
      expect(componentVersion).to.exist()
      expect(componentVersion.displayVersion).to.equal('v1.2.3 Beta.1')
    })

    it('should not overwrite display version with computed value if set', () => {
      aggregate[0].displayVersion = '1.2.3-beta.1'
      aggregate[0].prerelease = 'Beta.1'
      const catalog = classifyContent(playbook, aggregate)
      const componentVersion = catalog.getComponentVersion('the-component', 'v1.2.3')
      expect(componentVersion).to.exist()
      expect(componentVersion.displayVersion).to.equal('1.2.3-beta.1')
    })

    it('should throw when adding a duplicate version of a component', () => {
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
        files: [],
      })
      expect(() => classifyContent(playbook, aggregate)).to.throw('version')
    })

    it('should attach AsciiDoc config to component version if site AsciiDoc config is not specified', () => {
      const componentVersionAsciiDocConfig = { attributes: { foo: 'bar' } }
      aggregate[0].asciidoc = componentVersionAsciiDocConfig
      const contentCatalog = classifyContent(playbook, aggregate)
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      const componentVersions = component.versions
      expect(componentVersions).to.have.lengthOf(1)
      expect(component.asciidoc).to.deep.equal(componentVersionAsciiDocConfig)
      expect(componentVersions[0].asciidoc).to.deep.equal(componentVersionAsciiDocConfig)
    })

    it('should attach site AsciiDoc config to component version if component version has no AsciiDoc config', () => {
      const siteAsciiDocConfig = {
        attributes: { foo: 'bar' },
        extensions: [{ register: (registry) => {} }],
      }

      const contentCatalog = classifyContent(playbook, aggregate, siteAsciiDocConfig)
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      const componentVersions = component.versions
      expect(componentVersions).to.have.lengthOf(1)
      expect(component.asciidoc).to.equal(siteAsciiDocConfig)
      expect(componentVersions[0].asciidoc).to.equal(siteAsciiDocConfig)
    })

    it('should copy Asciidoctor extensions to scoped AsciiDoc config', () => {
      const siteAsciiDocConfig = {
        extensions: [{ register: (registry) => {} }],
      }

      aggregate[0].asciidoc = { attributes: { foo: 'bar' } }

      const contentCatalog = classifyContent(playbook, aggregate, siteAsciiDocConfig)
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      const componentVersions = component.versions
      expect(componentVersions).to.have.lengthOf(1)
      const asciidocConfig = componentVersions[0].asciidoc
      expect(asciidocConfig).to.have.property('extensions', siteAsciiDocConfig.extensions)
      expect(asciidocConfig).to.have.property('attributes')
      expect(asciidocConfig.attributes).to.include({ foo: 'bar' })
    })

    it('should only allow component descriptor to override attributes that are soft set', () => {
      const siteAsciiDocConfig = {
        attributes: {
          'hard-set': '',
          'hard-unset': null,
          'soft-set': '@',
          'soft-unset': false,
          'soft-unset-to-soft-set': false,
          'soft-reset': 'foo@',
        },
      }

      aggregate[0].asciidoc = {
        attributes: {
          'hard-set': 'override',
          'hard-unset': 'override',
          'soft-set': 'override',
          'soft-unset': 'override',
          'soft-unset-to-soft-set': 'override@',
          'soft-reset': 'bar@',
        },
      }

      const contentCatalog = classifyContent(playbook, aggregate, siteAsciiDocConfig)
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      const componentVersions = component.versions
      expect(componentVersions).to.have.lengthOf(1)
      const asciidocConfig = componentVersions[0].asciidoc
      expect(asciidocConfig).to.exist()
      expect(asciidocConfig).to.have.property('attributes')
      expect(Object.entries(asciidocConfig.attributes)).to.have.deep.ordered.members([
        ['hard-set', ''],
        ['hard-unset', null],
        ['soft-set', 'override'],
        ['soft-unset', 'override'],
        ['soft-unset-to-soft-set', 'override@'],
        ['soft-reset', 'bar@'],
      ])
    })

    it('should resolve attribute references in attribute value defined in component descriptor', () => {
      const siteAsciiDocConfig = {
        attributes: {
          'site-title': 'Docs',
          org: 'ACME',
          division: 'Explosives',
          'hard-unset': null,
          sectanchors: false,
          sectlinks: '@',
          idseparator: '-@',
        },
      }

      aggregate[0].asciidoc = {
        attributes: {
          'project-title': '{site-title} :: Project Name',
          'product-dept': '{org} :: {division}',
          toc: '{hard-unset}',
          sectlinks: '{sectanchors}',
          'title-separator': '{idseparator}',
          toclevels: 3,
        },
      }

      const contentCatalog = classifyContent(playbook, aggregate, siteAsciiDocConfig)
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      const componentVersions = component.versions
      expect(componentVersions).to.have.lengthOf(1)
      const asciidocConfig = componentVersions[0].asciidoc
      expect(asciidocConfig).to.exist()
      expect(asciidocConfig).to.have.property('attributes')
      expect(Object.entries(asciidocConfig.attributes)).to.have.deep.ordered.members([
        ['site-title', 'Docs'],
        ['org', 'ACME'],
        ['division', 'Explosives'],
        ['hard-unset', null],
        ['sectanchors', false],
        ['sectlinks', false],
        ['idseparator', '-@'],
        ['project-title', 'Docs :: Project Name'],
        ['product-dept', 'ACME :: Explosives'],
        ['toc', null],
        ['title-separator', '-'],
        ['toclevels', 3],
      ])
    })

    it('should ignore escaped attribute references', () => {
      const siteAsciiDocConfig = {
        attributes: { 'attribute-missing': 'warn', 'site-title': 'Docs' },
      }

      Object.assign(aggregate[0], {
        asciidoc: {
          attributes: { 'name-of-attribute': '\\{foo} and \\{bar}' },
        },
        origins: [{ url: 'https://githost/repo.git', startPath: 'docs', branch: 'v1.2.3' }],
      })

      const { messages, returnValue: contentCatalog } = captureLogSync(() =>
        classifyContent(playbook, aggregate, siteAsciiDocConfig)
      ).withReturnValue()
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      const componentVersions = component.versions
      expect(componentVersions).to.have.lengthOf(1)
      const asciidocConfig = componentVersions[0].asciidoc
      expect(asciidocConfig).to.exist()
      expect(asciidocConfig).to.have.property('attributes')
      expect(Object.entries(asciidocConfig.attributes)).to.have.deep.ordered.members([
        ['attribute-missing', 'warn'],
        ['site-title', 'Docs'],
        ['name-of-attribute', '{foo} and {bar}'],
      ])
      expect(messages).to.be.empty()
    })

    it('should skip attribute references to unknown or unset attribute', () => {
      const siteAsciiDocConfig = {
        attributes: {
          'attribute-missing': 'warn',
          'site-title': 'Docs',
          'hard-unset': null,
          'soft-unset': false,
        },
      }

      Object.assign(aggregate[0], {
        asciidoc: {
          attributes: {
            'project-title': '{unknown} :: Project Name',
            'product-dept': '{hard-unset} :: {soft-unset}',
          },
        },
        origins: [{ url: 'https://githost/repo.git', startPath: 'docs', branch: 'v1.2.3' }],
      })

      const { messages, returnValue: contentCatalog } = captureLogSync(() =>
        classifyContent(playbook, aggregate, siteAsciiDocConfig)
      ).withReturnValue()
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      const componentVersions = component.versions
      expect(componentVersions).to.have.lengthOf(1)
      const asciidocConfig = componentVersions[0].asciidoc
      expect(asciidocConfig).to.exist()
      expect(asciidocConfig).to.have.property('attributes')
      expect(Object.entries(asciidocConfig.attributes)).to.have.deep.ordered.members([
        ['attribute-missing', 'warn'],
        ['site-title', 'Docs'],
        ['hard-unset', null],
        ['soft-unset', false],
        ['project-title', '{unknown} :: Project Name'],
        ['product-dept', '{hard-unset} :: {soft-unset}'],
      ])
      expect(messages).to.have.lengthOf(3)
      const baseMessage = {
        level: 'warn',
        name: '@antora/asciidoc-loader',
        file: { path: 'docs/antora.yml' },
        source: {
          reftype: 'branch',
          startPath: 'docs',
          url: 'https://githost/repo.git',
        },
      }
      expect(messages[0]).to.eql(
        Object.assign({}, baseMessage, {
          msg: "Skipping reference to missing attribute 'unknown' in value of 'project-title' attribute",
        })
      )
      expect(messages[1]).to.eql(
        Object.assign({}, baseMessage, {
          msg: "Skipping reference to missing attribute 'hard-unset' in value of 'product-dept' attribute",
        })
      )
      expect(messages[2]).to.eql(
        Object.assign({}, baseMessage, {
          msg: "Skipping reference to missing attribute 'soft-unset' in value of 'product-dept' attribute",
        })
      )
    })

    it('should not warn if attribute is missing if attribute-missing attribute is not warn', () => {
      const siteAsciiDocConfig = {
        attributes: {
          'site-title': 'Docs',
        },
      }

      Object.assign(aggregate[0], {
        asciidoc: {
          attributes: {
            'project-title': '{site-title} :: {project-name}',
          },
        },
      })

      const { messages, returnValue: contentCatalog } = captureLogSync(() =>
        classifyContent(playbook, aggregate, siteAsciiDocConfig)
      ).withReturnValue()
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      const componentVersions = component.versions
      expect(componentVersions).to.have.lengthOf(1)
      const asciidocConfig = componentVersions[0].asciidoc
      expect(asciidocConfig).to.exist()
      expect(asciidocConfig).to.have.property('attributes')
      expect(Object.entries(asciidocConfig.attributes)).to.have.deep.ordered.members([
        ['site-title', 'Docs'],
        ['project-title', 'Docs :: {project-name}'],
      ])
      expect(messages).to.be.empty()
    })
  })

  describe('classify files', () => {
    it('should throw when attempting to add a duplicate page', () => {
      const file1 = createFile('modules/ROOT/pages/page-one.adoc')
      const file2 = createFile('modules/ROOT/pages/page-one.adoc')
      file2.src.origin.branch = file2.src.origin.refname = 'v1.2.x'
      aggregate[0].files.push(file1)
      aggregate[0].files.push(file2)
      const expectedMessage =
        'Duplicate page: v1.2.3@the-component::page-one.adoc\n' +
        '    1: modules/ROOT/pages/page-one.adoc in https://githost/repo.git (branch: v1.2.3)\n' +
        '    2: modules/ROOT/pages/page-one.adoc in https://githost/repo.git (branch: v1.2.x)'
      expect(() => classifyContent(playbook, aggregate)).to.throw(expectedMessage)
    })

    it('should throw when attempting to add a duplicate page between local branch and worktree', () => {
      const file1 = createFile('modules/ROOT/pages/page-one.adoc')
      const file2 = createFile('modules/ROOT/pages/page-one.adoc')
      file2.src.origin.branch = file2.src.origin.refname = 'v1.2.x'
      file2.src.origin.worktree = '/path/to/worktree'
      file2.src.abspath = '/path/to/worktree/' + file2.path
      aggregate[0].files.push(file1)
      aggregate[0].files.push(file2)
      const expectedMessage =
        'Duplicate page: v1.2.3@the-component::page-one.adoc\n' +
        '    1: modules/ROOT/pages/page-one.adoc in https://githost/repo.git (branch: v1.2.3)\n' +
        '    2: /path/to/worktree/modules/ROOT/pages/page-one.adoc in /path/to/worktree (branch: v1.2.x <worktree>)'
      expect(() => classifyContent(playbook, aggregate)).to.throw(expectedMessage)
    })

    it('should throw when attempting to add a duplicate page between remote branch and worktree', () => {
      const file1 = createFile('modules/ROOT/pages/page-one.adoc')
      const file2 = createFile('modules/ROOT/pages/page-one.adoc')
      file1.src.origin.worktree = null
      file1.src.origin.remote = 'origin'
      file1.src.origin.gitdir = '/path/to/repo/.git'
      file2.src.origin.branch = file2.src.origin.refname = 'v1.2.x'
      file2.src.origin.worktree = '/path/to/worktree'
      file2.src.abspath = '/path/to/worktree/' + file2.path
      aggregate[0].files.push(file1)
      aggregate[0].files.push(file2)
      const expectedMessage =
        'Duplicate page: v1.2.3@the-component::page-one.adoc\n' +
        '    1: modules/ROOT/pages/page-one.adoc in /path/to/repo/.git (branch: v1.2.3 <remotes/origin>)\n' +
        '    2: /path/to/worktree/modules/ROOT/pages/page-one.adoc in /path/to/worktree (branch: v1.2.x <worktree>)'
      expect(() => classifyContent(playbook, aggregate)).to.throw(expectedMessage)
    })

    it('should not classify page if it does not have the .adoc file extension', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/page-one.asc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.be.empty()
    })

    it('should classify a page with the .adoc file extension', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/page-one.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'page-one.adoc',
        basename: 'page-one.adoc',
        stem: 'page-one',
        extname: '.adoc',
        mediaType: 'text/asciidoc',
        moduleRootPath: '..',
      })
      expect(file.mediaType).to.equal('text/asciidoc')
      expect(file.out).to.include({
        path: 'the-component/v1.2.3/page-one.html',
        dirname: 'the-component/v1.2.3',
        basename: 'page-one.html',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/page-one.html',
        moduleRootPath: '.',
        rootPath: '../..',
      })
    })

    it('should classify a page in a topic dir', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/the-topic/page-one.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/pages/the-topic/page-one.adoc')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the-topic/page-one.adoc',
        basename: 'page-one.adoc',
        moduleRootPath: '../..',
      })
      expect(file.out).to.include({
        path: 'the-component/v1.2.3/the-topic/page-one.html',
        dirname: 'the-component/v1.2.3/the-topic',
        basename: 'page-one.html',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/the-topic/page-one.html',
        moduleRootPath: '..',
        rootPath: '../../..',
      })
    })

    it('should classify a page that contains spaces', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/the topic/i like spaces.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/pages/the topic/i like spaces.adoc')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'the topic/i like spaces.adoc',
        basename: 'i like spaces.adoc',
      })
      expect(file.out).to.include({
        path: 'the-component/v1.2.3/the topic/i like spaces.html',
        dirname: 'the-component/v1.2.3/the topic',
        basename: 'i like spaces.html',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/the%20topic/i%20like%20spaces.html',
        moduleRootPath: '..',
        rootPath: '../../..',
      })
    })

    it('should set the component url to the index page of the ROOT module by default', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      const expectedUrl = '/the-component/v1.2.3/index.html'
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.url).to.equal(expectedUrl)
      expect(component.versions[0].url).to.equal(expectedUrl)
    })

    it('should allow the start page to be specified for a component version', () => {
      aggregate[0].startPage = 'home.adoc'
      aggregate[0].files.push(createFile('modules/ROOT/pages/home.adoc'))
      const expectedUrl = '/the-component/v1.2.3/home.html'
      const contentCatalog = classifyContent(playbook, aggregate)
      const component = contentCatalog.getComponent('the-component')
      expect(component).to.exist()
      expect(component.url).to.equal(expectedUrl)
      expect(component.versions[0].url).to.equal(expectedUrl)
      const startPage = contentCatalog.getFiles().find((it) => it.src.family === 'alias')
      expect(startPage.mediaType).to.equal('text/html')
      expect(startPage.src.mediaType).to.equal('text/asciidoc')
    })

    it('should allow the start page in non-ROOT module to be specified for a component version', () => {
      aggregate[0].startPage = 'quickstarts:start-here.adoc'
      aggregate[0].files.push(createFile('modules/quickstarts/pages/start-here.adoc'))
      const expectedUrl = '/the-component/v1.2.3/quickstarts/start-here.html'
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.url).to.equal(expectedUrl)
      expect(component.versions[0].url).to.equal(expectedUrl)
    })

    it('should warn if start page specified for component version cannot be resolved', () => {
      aggregate[0].startPage = 'no-such-page.adoc'
      aggregate[0].files.push(createFile('modules/ROOT/pages/home.adoc'))
      const messages = captureLogSync(() => classifyContent(playbook, aggregate))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.match(/Start page .* not found/)
    })

    it('should warn if start page specified for component version has invalid syntax', () => {
      aggregate[0].startPage = 'the-component::'
      const messages = captureLogSync(() => classifyContent(playbook, aggregate))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.match(/Start page .* has invalid syntax/)
    })

    it('should set url to index page in ROOT module if found', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      const expectedUrl = '/the-component/v1.2.3/index.html'
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.url).to.equal(expectedUrl)
      expect(component.versions[0].url).to.equal(expectedUrl)
    })

    it('should set url to synthetic index page in ROOT module if page not found', () => {
      const expectedUrl = '/the-component/v1.2.3/index.html'
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.url).to.equal(expectedUrl)
      expect(component.versions[0].url).to.equal(expectedUrl)
    })

    it('should update url of component to match url of latest version', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      aggregate.push({
        name: 'the-component',
        title: 'The Component',
        version: 'v2.0.0',
        startPage: 'home.adoc',
        files: [createFile('modules/ROOT/pages/home.adoc')],
      })
      const component = classifyContent(playbook, aggregate).getComponent('the-component')
      expect(component).to.exist()
      expect(component.url).to.equal('/the-component/v2.0.0/home.html')
      expect(component.versions[0].url).to.equal('/the-component/v2.0.0/home.html')
      expect(component.versions[1].url).to.equal('/the-component/v1.2.3/index.html')
    })

    it('should classify a partial page without a file extension in pages/_partials', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/_partials/LICENSE'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/pages/_partials/LICENSE')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'partial',
        relative: 'LICENSE',
        basename: 'LICENSE',
        mediaType: undefined,
        moduleRootPath: '../..',
      })
      expect(file.mediaType).to.be.undefined()
      expect(file.out).to.not.exist()
      expect(file.pub).to.not.exist()
    })

    it('should classify a partial page with a file extension in pages/_partials', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/_partials/foo.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/pages/_partials/foo.adoc')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'partial',
        relative: 'foo.adoc',
        basename: 'foo.adoc',
        mediaType: 'text/asciidoc',
        moduleRootPath: '../..',
      })
      expect(file.mediaType).to.equal('text/asciidoc')
      expect(file.out).to.not.exist()
      expect(file.pub).to.not.exist()
    })

    it('should classify a partial page without a file extension in partials', () => {
      aggregate[0].files.push(createFile('modules/ROOT/partials/LICENSE'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/partials/LICENSE')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'partial',
        relative: 'LICENSE',
        basename: 'LICENSE',
        mediaType: undefined,
        moduleRootPath: '..',
      })
      expect(file.mediaType).to.be.undefined()
      expect(file.out).to.not.exist()
      expect(file.pub).to.not.exist()
    })

    it('should classify a partial page with a file extension in partials', () => {
      aggregate[0].files.push(createFile('modules/ROOT/partials/foo.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/partials/foo.adoc')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'partial',
        relative: 'foo.adoc',
        basename: 'foo.adoc',
        mediaType: 'text/asciidoc',
        moduleRootPath: '..',
      })
      expect(file.mediaType).to.equal('text/asciidoc')
      expect(file.out).to.not.exist()
      expect(file.pub).to.not.exist()
    })

    it('should throw when attempting to add a duplicate image', () => {
      const file1 = createFile('modules/admin/images/foo.png')
      const file2 = createFile('modules/admin/images/foo.png')
      file2.src.origin.branch = file2.src.origin.refname = 'v1.2.x'
      aggregate[0].files.push(file1)
      aggregate[0].files.push(file2)
      const expectedMessage =
        'Duplicate image: v1.2.3@the-component:admin:image$foo.png\n' +
        '    1: modules/admin/images/foo.png in https://githost/repo.git (branch: v1.2.3)\n' +
        '    2: modules/admin/images/foo.png in https://githost/repo.git (branch: v1.2.x)'
      expect(() => classifyContent(playbook, aggregate)).to.throw(expectedMessage)
    })

    it('should not classify an image without a file extension', () => {
      aggregate[0].files.push(createFile('modules/ROOT/images/image'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.be.empty()
    })

    it('should classify an image with a file extension', () => {
      aggregate[0].files.push(createFile('modules/ROOT/images/foo.png'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/images/foo.png')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'image',
        relative: 'foo.png',
        basename: 'foo.png',
        mediaType: 'image/png',
        moduleRootPath: '..',
      })
      expect(file.mediaType).to.equal('image/png')
      expect(file.out).to.include({
        path: 'the-component/v1.2.3/_images/foo.png',
        dirname: 'the-component/v1.2.3/_images',
        basename: 'foo.png',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/_images/foo.png',
      })
    })

    it('should classify an image under assets', () => {
      aggregate[0].files.push(createFile('modules/ROOT/assets/images/foo.png'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/assets/images/foo.png')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'image',
        relative: 'foo.png',
        basename: 'foo.png',
        moduleRootPath: '../..',
      })
      expect(file.out).to.include({
        path: 'the-component/v1.2.3/_images/foo.png',
        dirname: 'the-component/v1.2.3/_images',
        basename: 'foo.png',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/_images/foo.png',
      })
    })

    it('should not classify an attachment without a file extension', () => {
      aggregate[0].files.push(createFile('modules/ROOT/attachments/example'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.be.empty()
    })

    it('should classify an attachment with a file extension', () => {
      aggregate[0].files.push(createFile('modules/ROOT/attachments/example.zip'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/attachments/example.zip')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'attachment',
        relative: 'example.zip',
        basename: 'example.zip',
        mediaType: 'application/zip',
        moduleRootPath: '..',
      })
      expect(file.mediaType).to.equal('application/zip')
      expect(file.out).to.include({
        path: 'the-component/v1.2.3/_attachments/example.zip',
        dirname: 'the-component/v1.2.3/_attachments',
        basename: 'example.zip',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/_attachments/example.zip',
      })
    })

    it('should not modify the file extension of an attachment with the file extension .adoc', () => {
      aggregate[0].files.push(createFile('modules/ROOT/attachments/example.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/attachments/example.adoc')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'attachment',
        relative: 'example.adoc',
        basename: 'example.adoc',
        mediaType: 'text/asciidoc',
        moduleRootPath: '..',
      })
      expect(file.mediaType).to.equal('text/asciidoc')
      expect(file.out).to.include({
        path: 'the-component/v1.2.3/_attachments/example.adoc',
        dirname: 'the-component/v1.2.3/_attachments',
        basename: 'example.adoc',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/_attachments/example.adoc',
      })
    })

    it('should classify an attachment under the assets folder', () => {
      aggregate[0].files.push(createFile('modules/ROOT/assets/attachments/example.zip'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/assets/attachments/example.zip')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'attachment',
        relative: 'example.zip',
        basename: 'example.zip',
        moduleRootPath: '../..',
      })
      expect(file.out).to.include({
        path: 'the-component/v1.2.3/_attachments/example.zip',
        dirname: 'the-component/v1.2.3/_attachments',
        basename: 'example.zip',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/_attachments/example.zip',
      })
    })

    it('should classify an example without a file extension', () => {
      aggregate[0].files.push(createFile('modules/ROOT/examples/Dockerfile'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/examples/Dockerfile')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'example',
        relative: 'Dockerfile',
        basename: 'Dockerfile',
        mediaType: undefined,
        moduleRootPath: '..',
      })
      expect(file.mediaType).to.be.undefined()
      expect(file.out).to.not.exist()
      expect(file.pub).to.not.exist()
    })

    it('should classify an example with a file extension', () => {
      aggregate[0].files.push(createFile('modules/ROOT/examples/foo.xml'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/ROOT/examples/foo.xml')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'example',
        relative: 'foo.xml',
        basename: 'foo.xml',
        mediaType: 'application/xml',
        moduleRootPath: '..',
      })
      expect(file.mediaType).to.equal('application/xml')
      expect(file.out).to.not.exist()
      expect(file.pub).to.not.exist()
    })

    it('should throw when attempting to add a duplicate nav outside of module', () => {
      const file1 = createFile('modules/nav.adoc')
      file1.src.origin.startPath = 'docs'
      const file2 = createFile('modules/nav.adoc')
      file2.src.origin.branch = file2.src.origin.refname = 'v1.2.x'
      file2.src.origin.startPath = 'docs'
      aggregate[0].files.push(file1)
      aggregate[0].files.push(file2)
      aggregate[0].nav = ['modules/nav.adoc']
      const expectedMessage =
        'Duplicate nav in v1.2.3@the-component: modules/nav.adoc\n' +
        '    1: docs/modules/nav.adoc in https://githost/repo.git (branch: v1.2.3 | start path: docs)\n' +
        '    2: docs/modules/nav.adoc in https://githost/repo.git (branch: v1.2.x | start path: docs)'
      expect(() => classifyContent(playbook, aggregate)).to.throw(expectedMessage)
    })

    it('should throw when attempting to add a duplicate nav inside of module', () => {
      const file1 = createFile('modules/install/nav.adoc')
      const file2 = createFile('modules/install/nav.adoc')
      file1.src.origin.branch = file1.src.origin.refname = 'v1.2.x'
      file2.src.origin.tag = file2.src.origin.refname = 'v1.2.3'
      delete file2.src.origin.branch
      aggregate[0].files.push(file1)
      aggregate[0].files.push(file2)
      aggregate[0].nav = ['modules/install/nav.adoc']
      const expectedMessage =
        'Duplicate nav in v1.2.3@the-component: modules/install/nav.adoc\n' +
        '    1: modules/install/nav.adoc in https://githost/repo.git (branch: v1.2.x)\n' +
        '    2: modules/install/nav.adoc in https://githost/repo.git (tag: v1.2.3)'
      expect(() => classifyContent(playbook, aggregate)).to.throw(expectedMessage)
    })

    it('should warn if entry in nav cannot be resolved', () => {
      const expectedMsg =
        'Could not resolve nav entry for v1.2.3@the-component ' +
        'defined in antora.yml in https://githost/repo.git (branch: v1.2.3): no-such-file.adoc'
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      aggregate[0].nav = Object.assign(['no-such-file.adoc'], { origin: aggregate[0].files[0].src.origin })
      const messages = captureLogSync(() => classifyContent(playbook, aggregate))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.equal(expectedMsg)
    })

    it('should classify a navigation file in module', () => {
      aggregate[0].nav = ['modules/module-a/nav.adoc']
      aggregate[0].files.push(createFile('modules/module-a/pages/index.adoc'))
      aggregate[0].files.push(createFile('modules/module-a/nav.adoc'))
      const contentCatalog = classifyContent(playbook, aggregate)
      const files = contentCatalog.findBy({ family: 'nav' })
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/module-a/nav.adoc')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'module-a',
        family: 'nav',
        relative: 'nav.adoc',
        basename: 'nav.adoc',
        mediaType: 'text/asciidoc',
        moduleRootPath: '.',
      })
      expect(file.mediaType).to.equal('text/asciidoc')
      expect(file.out).to.not.exist()
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/module-a/',
        moduleRootPath: '.',
      })
    })

    it('should classify a navigation file in subdir of module', () => {
      aggregate[0].nav = ['modules/module-a/nav/primary.adoc']
      aggregate[0].files.push(createFile('modules/module-a/nav/primary.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/module-a/nav/primary.adoc')
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'module-a',
        family: 'nav',
        relative: 'nav/primary.adoc',
        basename: 'primary.adoc',
        moduleRootPath: '..',
      })
      expect(file.out).to.not.exist()
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/module-a/',
        moduleRootPath: '.',
      })
    })

    it('should classify a navigation file outside of module', () => {
      aggregate[0].nav = ['modules/nav.adoc']
      aggregate[0].files.push(createFile('modules/nav.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.path).to.equal('modules/nav.adoc')
      expect(file.src.module).to.not.exist()
      expect(file.src).to.include({
        component: 'the-component',
        version: 'v1.2.3',
        family: 'nav',
        relative: 'modules/nav.adoc',
        basename: 'nav.adoc',
      })
      expect(file.out).to.not.exist()
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/',
        moduleRootPath: '.',
      })
    })

    it('should not classify a navigation file if not in nav list', () => {
      aggregate[0].files.push(createFile('modules/ROOT/nav.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.be.empty()
    })

    // QUESTION should we throw an error or warning?
    it('should not register navigation file that points to nonexistent file', () => {
      aggregate[0].nav = ['modules/ROOT/no-such-file.adoc']
      aggregate[0].files.push(createFile('modules/ROOT/pages/the-page.adoc'))
      aggregate[0].files.push(createFile('modules/ROOT/nav.adoc'))
      const contentCatalog = classifyContent(playbook, aggregate)
      expect(contentCatalog.findBy({ family: 'nav' })).to.be.empty()
    })

    it('should not register navigation file that does not have .adoc file extension', () => {
      aggregate[0].nav = ['modules/ROOT/nav.asc']
      aggregate[0].files.push(createFile('modules/ROOT/nav.asc'))
      const contentCatalog = classifyContent(playbook, aggregate)
      expect(contentCatalog.findBy({ family: 'nav' })).to.be.empty()
    })

    it('should assign a nav.index property to navigation file according to order listed in component descriptor', () => {
      aggregate[0].nav = ['modules/ROOT/nav.adoc', 'modules/module-a/nav.adoc', 'modules/module-b/nav.adoc']
      aggregate[0].files.push(
        ...[
          createFile('modules/module-b/nav.adoc'),
          createFile('modules/ROOT/nav.adoc'),
          createFile('modules/module-a/nav.adoc'),
        ]
      )
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(3)
      files.sort((a, b) => (a.nav.index < b.nav.index ? -1 : a.nav.index > b.nav.index ? 1 : 0))
      expect(files[0].path).to.equal('modules/ROOT/nav.adoc')
      expect(files[0].nav.index).to.equal(0)
      expect(files[0].src.module).to.equal('ROOT')
      expect(files[0].src.relative).to.equal('nav.adoc')
      expect(files[1].path).to.equal('modules/module-a/nav.adoc')
      expect(files[1].nav.index).to.equal(1)
      expect(files[1].src.module).to.equal('module-a')
      expect(files[1].src.relative).to.equal('nav.adoc')
      expect(files[2].path).to.equal('modules/module-b/nav.adoc')
      expect(files[2].nav.index).to.equal(2)
      expect(files[2].src.module).to.equal('module-b')
      expect(files[2].src.relative).to.equal('nav.adoc')
    })

    it('should not classify files that do not fall in the standard project structure', () => {
      aggregate[0].files.push(
        ...[
          createFile(COMPONENT_DESC_FILENAME),
          createFile('README.adoc'),
          createFile('modules/ROOT/_attributes.adoc'),
          createFile('modules/ROOT/assets/bad-file.png'),
          createFile('modules/ROOT/pages/bad-file.xml'),
          createFile('modules/ROOT/documents/index.adoc'),
          createFile('modules/ROOT/bad-folder/bad-file.yml'),
        ]
      )
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.be.empty()
    })

    it('should ignore file with path that refers to location outside of repository', () => {
      aggregate[0].files.push(...[createFile(COMPONENT_DESC_FILENAME), createFile('../not-gonna-happen.adoc')])
      aggregate[0].files[1].src.path = '../not-gonna-happen.adoc'
      const files = classifyContent(playbook, aggregate).getAll()
      expect(files).to.have.lengthOf(0)
    })

    it('should classify files from multiple components and versions', () => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          files: [createFile('modules/ROOT/pages/page-one.adoc')],
        },
        {
          name: 'the-other-component',
          title: 'The Other Component',
          version: 'v4.5.6',
          files: [createFile('modules/basics/pages/page-two.adoc')],
        },
      ]
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(2)
      files.sort((a, b) => a.src.module.localeCompare(b.src.module))
      expect(files[0].path).to.equal('modules/basics/pages/page-two.adoc')
      expect(files[0].src).to.include({ component: 'the-other-component', version: 'v4.5.6', module: 'basics' })
      expect(files[1].path).to.equal('modules/ROOT/pages/page-one.adoc')
      expect(files[1].src).to.include({ component: 'the-component', version: 'v1.2.3', module: 'ROOT' })
    })

    it('should throw when two identical files are found in different sources', () => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          files: [createFile('modules/ROOT/pages/page-one.adoc')],
        },
        {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          files: [createFile('modules/ROOT/pages/page-one.adoc')],
        },
      ]
      expect(() => classifyContent({}, aggregate)).to.throw()
    })
  })

  describe('site start page', () => {
    it('should not register site start page if not specified', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      const contentCatalog = classifyContent(playbook, aggregate)
      const files = contentCatalog.getFiles()
      expect(files).to.have.lengthOf(1)
      const expected = contentCatalog.getById({
        component: 'the-component',
        version: 'v1.2.3',
        module: 'ROOT',
        family: 'page',
        relative: 'index.adoc',
      })
      expect(files[0]).to.eql(expected)
    })

    it('should register site start page if specified', () => {
      playbook.site.startPage = 'v1.2.3@the-component:ROOT:index.adoc'
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      const contentCatalog = classifyContent(playbook, aggregate)
      const files = contentCatalog.getFiles()
      expect(files).to.have.lengthOf(2)
      const expected = contentCatalog.getById({
        component: 'ROOT',
        version: '',
        module: 'ROOT',
        family: 'alias',
        relative: 'index.adoc',
      })
      expect(expected).to.exist()
      expect(expected).to.have.property('synthetic', true)
      expect(expected.mediaType).to.equal('text/html')
      expect(expected.src.mediaType).to.equal('text/asciidoc')
    })

    it('should warn if site start page not found', () => {
      playbook.site.startPage = 'the-component::no-such-page.adoc'
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      const expectedMessage = /Start page specified for site not found: the-component::no-such-page\.adoc/
      const messages = captureLogSync(() => classifyContent(playbook, aggregate))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.match(expectedMessage)
    })

    it('should warn if site start page has invalid syntax', () => {
      playbook.site.startPage = 'the-component::'
      const expectedMessage = /Start page specified for site has invalid syntax: the-component::/
      const messages = captureLogSync(() => classifyContent(playbook, aggregate))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.match(expectedMessage)
    })

    it('should warn if site start page spec does not specify a component or module', () => {
      playbook.site.startPage = 'no-such-page.adoc'
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      const expectedMessage = /Missing component name in start page for site: no-such-page\.adoc/
      const messages = captureLogSync(() => classifyContent(playbook, aggregate))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.match(expectedMessage)
    })

    it('should warn if site start page spec does not specify a component', () => {
      playbook.site.startPage = 'ROOT:no-such-page.adoc'
      aggregate[0].files.push(createFile('modules/ROOT/pages/index.adoc'))
      const expectedMessage = /Missing component name in start page for site: ROOT:no-such-page\.adoc/
      const messages = captureLogSync(() => classifyContent(playbook, aggregate))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('warn')
      expect(messages[0].msg).to.match(expectedMessage)
    })

    it('should favor site start page over start page for versionless ROOT component', () => {
      playbook.site.startPage = 'the-component::start.adoc'
      aggregate[0].files.push(createFile('modules/ROOT/pages/start.adoc'))
      aggregate.push({
        name: 'ROOT',
        version: '',
        start_page: 'home.adoc',
        files: [createFile('modules/ROOT/pages/home.adoc')],
      })
      const contentCatalog = classifyContent(playbook, aggregate)
      const startPage = contentCatalog.getSiteStartPage()
      expect(startPage).to.exist()
      expect(startPage).to.have.nested.property('src.component', 'the-component')
      expect(startPage).to.have.nested.property('src.relative', 'start.adoc')
    })
  })

  describe('assign correct out and pub properties to files', () => {
    it('complete example', () => {
      aggregate[0].files.push(createFile('modules/the-module/pages/the-topic/page-one.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/the-topic',
        basename: 'page-one.html',
        path: 'the-component/v1.2.3/the-module/the-topic/page-one.html',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/the-module/the-topic/page-one.html',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
    })

    it('page in topic dirs', () => {
      aggregate[0].files.push(createFile('modules/the-module/pages/subpath-foo/subpath-bar/page-one.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/subpath-foo/subpath-bar',
        basename: 'page-one.html',
        path: 'the-component/v1.2.3/the-module/subpath-foo/subpath-bar/page-one.html',
        moduleRootPath: '../..',
        rootPath: '../../../../..',
      })
    })

    it('page without topic dir', () => {
      aggregate[0].files.push(createFile('modules/the-module/pages/page-one.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module',
        basename: 'page-one.html',
        path: 'the-component/v1.2.3/the-module/page-one.html',
        moduleRootPath: '.',
        rootPath: '../../..',
      })
    })

    it('page in ROOT module', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/page-one.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3',
        basename: 'page-one.html',
        path: 'the-component/v1.2.3/page-one.html',
        moduleRootPath: '.',
        rootPath: '../..',
      })
    })

    it('page in ROOT component', () => {
      Object.assign(aggregate[0], { name: 'ROOT' })
      aggregate[0].files.push(createFile('modules/ROOT/pages/the-page.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'v1.2.3',
        basename: 'the-page.html',
        path: 'v1.2.3/the-page.html',
        moduleRootPath: '.',
        rootPath: '..',
      })
      expect(file.pub.url).to.equal('/v1.2.3/the-page.html')
    })

    it('page in versionless ROOT component', () => {
      Object.assign(aggregate[0], { name: 'ROOT', version: '' })
      aggregate[0].files.push(createFile('modules/ROOT/pages/home.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: '.',
        basename: 'home.html',
        path: 'home.html',
        moduleRootPath: '.',
        rootPath: '.',
      })
      expect(file.pub.url).to.equal('/home.html')
    })

    it('should not create duplicate site start page if ROOT component has index page', () => {
      Object.assign(aggregate[0], { name: 'ROOT', version: '' })
      const homePageContents = Buffer.from('= Home Page')
      aggregate[0].files.push(
        Object.assign(createFile('modules/ROOT/pages/index.adoc'), { contents: homePageContents })
      )
      playbook.site.startPage = 'ROOT::index.adoc'
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: '.',
        basename: 'index.html',
        path: 'index.html',
        moduleRootPath: '.',
        rootPath: '.',
      })
      expect(file.pub.url).to.equal('/index.html')
      expect(file).to.not.have.property('rel')
      expect(file.contents).to.equal(homePageContents)
    })

    it('should not set out and pub on file with leading underscore', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/_attributes.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file).to.not.have.property('out')
      expect(file).to.not.have.property('pub')
    })

    it('should not set out and pub on file in directory with leading underscore', () => {
      aggregate[0].files.push(createFile('modules/ROOT/pages/_attributes/common.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file).to.not.have.property('out')
      expect(file).to.not.have.property('pub')
    })

    it('with master version', () => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'master',
          files: [createFile('modules/the-module/pages/page-one.adoc')],
        },
      ]
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/the-module',
        basename: 'page-one.html',
        path: 'the-component/the-module/page-one.html',
        moduleRootPath: '.',
        rootPath: '../..',
      })
    })

    it('with empty version', () => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: '',
          files: [createFile('modules/the-module/pages/page-one.adoc')],
        },
      ]
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/the-module',
        basename: 'page-one.html',
        path: 'the-component/the-module/page-one.html',
        moduleRootPath: '.',
        rootPath: '../..',
      })
    })

    it('with ROOT module and master version', () => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: 'master',
          files: [createFile('modules/ROOT/pages/page-one.adoc')],
        },
      ]
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component',
        basename: 'page-one.html',
        path: 'the-component/page-one.html',
        moduleRootPath: '.',
        rootPath: '..',
      })
    })

    it('with ROOT module and empty version', () => {
      aggregate = [
        {
          name: 'the-component',
          title: 'The Component',
          version: '',
          files: [createFile('modules/ROOT/pages/page-one.adoc')],
        },
      ]
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component',
        basename: 'page-one.html',
        path: 'the-component/page-one.html',
        moduleRootPath: '.',
        rootPath: '..',
      })
    })

    it('image', () => {
      aggregate[0].files.push(createFile('modules/the-module/assets/images/foo.png'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/_images',
        basename: 'foo.png',
        path: 'the-component/v1.2.3/the-module/_images/foo.png',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
    })

    it('attachment', () => {
      aggregate[0].files.push(createFile('modules/the-module/assets/attachments/example.zip'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/_attachments',
        basename: 'example.zip',
        path: 'the-component/v1.2.3/the-module/_attachments/example.zip',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
    })

    it('image with drop html extension strategy', () => {
      playbook.urls.htmlExtensionStyle = 'drop'
      aggregate[0].files.push(createFile('modules/the-module/assets/images/foo.png'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/_images',
        basename: 'foo.png',
        path: 'the-component/v1.2.3/the-module/_images/foo.png',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/the-module/_images/foo.png',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
    })

    it('page with drop html extension strategy', () => {
      playbook.urls.htmlExtensionStyle = 'drop'
      aggregate[0].files.push(createFile('modules/the-module/pages/the-topic/page-one.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/the-topic',
        basename: 'page-one.html',
        path: 'the-component/v1.2.3/the-module/the-topic/page-one.html',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/the-module/the-topic/page-one',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
    })

    it('index page with drop html extension strategy', () => {
      playbook.urls.htmlExtensionStyle = 'drop'
      aggregate[0].files.push(createFile('modules/the-module/pages/the-topic/index.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/the-topic',
        basename: 'index.html',
        path: 'the-component/v1.2.3/the-module/the-topic/index.html',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/the-module/the-topic/',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
    })

    it('indexify html extension strategy', () => {
      playbook.urls.htmlExtensionStyle = 'indexify'
      aggregate[0].files.push(createFile('modules/the-module/pages/the-topic/page-one.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/the-topic/page-one',
        basename: 'index.html',
        path: 'the-component/v1.2.3/the-module/the-topic/page-one/index.html',
        moduleRootPath: '../..',
        rootPath: '../../../../..',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/the-module/the-topic/page-one/',
        moduleRootPath: '../..',
        rootPath: '../../../../..',
      })
    })

    it('index page with indexify html extension strategy', () => {
      playbook.urls.htmlExtensionStyle = 'indexify'
      aggregate[0].files.push(createFile('modules/the-module/pages/the-topic/index.adoc'))
      const files = classifyContent(playbook, aggregate).getFiles()
      expect(files).to.have.lengthOf(1)
      const file = files[0]
      expect(file.out).to.include({
        dirname: 'the-component/v1.2.3/the-module/the-topic',
        basename: 'index.html',
        path: 'the-component/v1.2.3/the-module/the-topic/index.html',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
      expect(file.pub).to.include({
        url: '/the-component/v1.2.3/the-module/the-topic/',
        moduleRootPath: '..',
        rootPath: '../../../..',
      })
    })
  })
})

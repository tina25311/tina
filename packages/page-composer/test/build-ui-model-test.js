/* eslint-env mocha */
'use strict'

const { expect, spy } = require('@antora/test-harness')

const {
  buildBaseUiModel,
  buildPageUiModel,
  buildSiteUiModel,
  buildUiModel,
} = require('@antora/page-composer/build-ui-model')
const { version: VERSION } = require('@antora/page-composer/package.json')

describe('build UI model', () => {
  let playbook
  let component
  let components
  let contentCatalog
  let contentCatalogModel
  let file
  let menu
  let navigationCatalog
  let startPage

  beforeEach(() => {
    playbook = {
      site: {
        title: 'Docs Site',
      },
      ui: {
        outputDir: '_/',
      },
    }

    components = [
      {
        name: 'component-c',
        title: 'Component C',
      },
      {
        name: 'the-component',
        title: 'The Component',
        url: '/the-component/1.0/index.html',
        versions: [
          {
            version: '1.0',
            title: 'The Component',
            url: '/the-component/1.0/index.html',
            displayVersion: 'Io',
          },
        ],
      },
      {
        name: 'component-b',
        title: 'Component B',
      },
    ]

    component = components[1]

    startPage = undefined

    contentCatalog = {
      getComponent: spy((name) => component),
      getComponentVersion: (component, version) => {
        if (!component.versions) component = this.getComponent(component)
        return component.versions.find((candidate) => candidate.version === version)
      },
      getComponentsSortedBy: spy((property) =>
        components.slice(0).sort((a, b) => a[property].localeCompare(b[property]))
      ),
      getSiteStartPage: spy(() => startPage),
    }

    contentCatalogModel = {
      getComponent: contentCatalog.getComponent.bind(contentCatalog),
      getComponentVersion: contentCatalog.getComponentVersion.bind(contentCatalog),
      getComponentsSortedBy: contentCatalog.getComponentsSortedBy.bind(contentCatalog),
      getSiteStartPage: contentCatalog.getSiteStartPage.bind(contentCatalog),
    }

    contentCatalog.exportToModel = spy(() => contentCatalogModel)

    menu = []

    navigationCatalog = {
      getNavigation: spy((name, version) => menu),
    }

    file = {
      contents: Buffer.from('contents'),
      path: 'modules/ROOT/pages/the-page.adoc',
      src: {
        family: 'page',
        path: 'modules/ROOT/pages/the-page.adoc',
        component: 'the-component',
        version: '1.0',
        module: 'ROOT',
        relative: 'the-page.adoc',
      },
      pub: {
        url: '/the-component/1.0/the-page.html',
        rootPath: '../..',
      },
    }
  })

  describe('buildBaseUiModel()', () => {
    it('should set antoraVersion property to version of Antora', () => {
      const model = buildBaseUiModel(playbook, contentCatalog)
      expect(model.antoraVersion).to.exist()
      expect(model.antoraVersion).to.equal(VERSION)
    })

    it('should set env property to provided env object', () => {
      playbook.env = { FOO: 'BAR' }
      const model = buildBaseUiModel(playbook, contentCatalog)
      expect(model.env).to.exist()
      expect(model.env).to.equal(playbook.env)
    })

    it('should set contentCatalog property to exported content catalog', () => {
      const model = buildBaseUiModel(playbook, contentCatalog)
      expect(contentCatalog.exportToModel).to.have.been.called.once()
      expect(model.contentCatalog).to.exist()
      expect(model.contentCatalog).to.not.equal(contentCatalog)
      expect(model.contentCatalog.getComponent('the-component').name).to.equal('the-component')
    })

    it('should set site property', () => {
      const model = buildBaseUiModel(playbook, contentCatalog)
      expect(model.site).to.exist()
      expect(model.site.components).to.exist()
      expect(model.site).to.deep.equal(buildSiteUiModel(playbook, contentCatalogModel))
    })
  })

  describe('buildSiteUiModel()', () => {
    it('should set title property to value of site.title property from playbook', () => {
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.title).to.equal('Docs Site')
    })

    it('should set keys property to an empty object if keys property is missing from the playbook', () => {
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.keys).to.exist()
      expect(model.keys).to.eql({})
    })

    it('should populate keys property with entries in site.keys property from playbook', () => {
      playbook.site.keys = {
        googleAnalytics: 'UA-XXXXXXXX-1',
        swiftype: 'ABC123XYZ',
      }
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.keys).to.eql({ googleAnalytics: 'UA-XXXXXXXX-1', swiftype: 'ABC123XYZ' })
    })

    it('should set components property to map of components from content catalog sorted by title', () => {
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(contentCatalog.getComponentsSortedBy).to.have.been.called.once()
      expect(Object.keys(model.components)).to.have.lengthOf(3)
      const componentTitles = Object.values(model.components).map((component) => component.title)
      expect(componentTitles).to.eql(['Component B', 'Component C', 'The Component'])
    })

    it('should be able to access navigation for any component version from UI model', () => {
      const component = contentCatalog.getComponent('the-component')
      menu.push({
        order: 0,
        root: true,
        items: [
          {
            content: 'The Page',
            url: '/the-component/1.0/the-page.html',
            urlType: 'internal',
          },
        ],
      })
      component.versions[0].navigation = navigationCatalog.getNavigation('the-component', '1.0')
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.components['the-component'].versions[0].navigation).to.exist()
      expect(model.components['the-component'].versions[0].navigation.length).to.equal(1)
      expect(model.components['the-component'].versions[0].navigation[0]).to.equal(menu[0])
    })

    it('should not set url property if site.url property is not set in playbook', () => {
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.url).to.not.exist()
    })

    it('should set url property to / if site.url property is set to / in playbook', () => {
      playbook.site.url = '/'
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.url).to.equal('/')
    })

    it('should set url property if site.url property is set in playbook', () => {
      playbook.site.url = 'https://example.com'
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.url).to.equal('https://example.com')
    })

    it('should remove trailing slash from site URL before assigning to url property', () => {
      playbook.site.url = 'https://example.com/'
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.url).to.equal('https://example.com')
    })

    it('should remove trailing slash from site URL with subpath before assigning to url property', () => {
      playbook.site.url = 'https://example.com/docs/'
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.url).to.equal('https://example.com/docs')
    })

    it('should not set path property if site.url property is not set in playbook', () => {
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model).to.not.have.property('path')
    })

    it('should set path property to empty if site.url property set in playbook has no subpath', () => {
      ;['https://example.com', 'https://example.com/', '/'].forEach((siteUrl) => {
        playbook.site.url = siteUrl
        const model = buildSiteUiModel(playbook, contentCatalogModel)
        expect(model.path).to.equal('')
      })
    })

    it('should set path property to pathname of URL if site.url property set in playbook', () => {
      ;['https://example.com/docs', 'https://example.com/docs/', '/docs', '/docs/'].forEach((siteUrl) => {
        playbook.site.url = siteUrl
        const model = buildSiteUiModel(playbook, contentCatalogModel)
        expect(model.path).to.equal('/docs')
      })
    })

    it('should not set homeUrl property if site start page is not defined', () => {
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(contentCatalog.getSiteStartPage).to.have.been.called.once()
      expect(model.homeUrl).to.not.exist()
    })

    it('should set homeUrl property to url of site start page', () => {
      startPage = {
        src: {
          family: 'page',
        },
        pub: { url: '/path/to/home.html' },
      }
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(contentCatalog.getSiteStartPage).to.have.been.called.once()
      expect(model.homeUrl).to.equal('/path/to/home.html')
    })

    it('should set homeUrl property to url of page to which site start page alias points', () => {
      startPage = {
        src: {
          family: 'alias',
        },
        rel: {
          pub: { url: '/path/to/home.html' },
        },
      }.rel
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(contentCatalog.getSiteStartPage).to.have.been.called.once()
      expect(model.homeUrl).to.equal('/path/to/home.html')
    })

    it('should set defaultLayout property on ui property to "default" by default', () => {
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.ui.defaultLayout).to.equal('default')
    })

    it('should set defaultLayout property on ui property to value of ui.defaultLayout from playbook', () => {
      playbook.ui.defaultLayout = 'article'
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.ui.defaultLayout).to.equal('article')
    })

    it('should set url property on ui property to root relative path (sans trailing slash)', () => {
      const model = buildSiteUiModel(playbook, contentCatalogModel)
      expect(model.ui.url).to.equal('/_')
    })
  })

  describe('buildPageUiModel()', () => {
    let site

    beforeEach(() => {
      site = {
        title: 'Docs Site',
        ui: {},
      }
    })

    it('should set component property to component from content catalog', () => {
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(contentCatalog.getComponent).nth(1).called.with('the-component')
      expect(model.component).to.exist()
      expect(model.component.name).to.equal('the-component')
    })

    it('should set componentVersion property to component version from content catalog', () => {
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.componentVersion).to.exist()
      expect(model.componentVersion).to.equal(component.versions[0])
    })

    it('should set the module, version, and relativeSrcPath properties using values from file src object', () => {
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.module).to.exist()
      expect(model.module).to.equal('ROOT')
      expect(model.version).to.exist()
      expect(model.version).to.equal('1.0')
      expect(model.displayVersion).to.equal(model.componentVersion.displayVersion)
      expect(model.relativeSrcPath).to.exist()
      expect(model.relativeSrcPath).to.equal('the-page.adoc')
    })

    it('should set origin property to value from file src object', () => {
      file.src.origin = {
        type: 'git',
        url: 'git@github.com:foo/bar.git',
        branch: 'master',
        editUrlPattern: 'https://github.com/foo/bar/edit/master/%s',
      }
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.origin).to.exist()
      expect(model.origin).to.equal(file.src.origin)
    })

    it('should set editUrl and fileUri properties from file.src object', () => {
      file.src.editUrl = 'https://github.com/org/repo/edit/master/modules/ROOT/pages/the-page.adoc'
      file.src.fileUri = 'file:///path/to/worktree/modules/ROOT/pages/the-page.adoc'
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.editUrl).to.equal(file.src.editUrl)
      expect(model.fileUri).to.equal(file.src.fileUri)
    })

    it('should set url property to pub url of file', () => {
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.url).to.equal('/the-component/1.0/the-page.html')
    })

    it('should set contents property to contents of file', () => {
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.contents).to.equal(file.contents)
    })

    it('should set canonicalUrl property based on pub url of file has no other versions', () => {
      site.url = 'http://example.com'
      component.latest = component.versions[0]
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.equal('http://example.com/the-component/1.0/the-page.html')
    })

    it('should set home property to falsy value if url of page does not match site homeUrl property', () => {
      site.homeUrl = '/path/to/home.html'
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.home || false).to.be.false()
    })

    it('should set home property to true if url of page matches site homeUrl property', () => {
      site.homeUrl = file.pub.url
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.home).to.be.true()
    })

    it('should set title, author, description, keywords, and role based on AsciiDoc attributes', () => {
      file.asciidoc = {
        doctitle: 'The Page Title',
        attributes: {
          author: 'Doc Writer',
          description: 'A description of this page',
          keywords: 'keyword-a, keyword-b',
          role: 'the-role',
        },
      }
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.title).to.equal(file.asciidoc.doctitle)
      expect(model.author).to.equal(file.asciidoc.attributes.author)
      expect(model.description).to.equal(file.asciidoc.attributes.description)
      expect(model.keywords).to.equal(file.asciidoc.attributes.keywords)
      expect(model.role).to.equal('the-role')
    })

    it('should derive value of attributes property based on AsciiDoc attributes prefixed with page-', () => {
      file.asciidoc = {
        attributes: {
          'page-foo': 'bar',
          'page-tags': 'basics,guide',
        },
      }
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.attributes).to.eql({
        foo: 'bar',
        tags: 'basics,guide',
      })
    })

    it('should set layout property to value of page-layout attribute', () => {
      file.asciidoc = {
        attributes: { 'page-layout': 'chapter' },
      }
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.layout).to.equal('chapter')
    })

    it('should set layout property to default layout if the page-layout attribute is not specified', () => {
      site.ui.defaultLayout = 'default'
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.layout).to.equal('default')
    })

    it('should set navigation property to empty array if no navigation is defined for component version', () => {
      menu = undefined
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.navigation).to.exist()
      expect(model.navigation).to.be.empty()
    })

    it('should set navigation property to menu in navigation catalog', () => {
      menu.push({
        order: 0,
        root: true,
        items: [
          {
            content: 'Item',
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(navigationCatalog.getNavigation).nth(1).called.with('the-component', '1.0')
      expect(model.navigation).to.exist()
      expect(model.navigation).to.equal(menu)
    })

    it('should set breadcrumbs property to path of page in navigation tree', () => {
      let itemB
      let itemC
      menu.push({
        order: 0,
        root: true,
        content: 'Nav Title',
        url: '/the-component/1.0/index.html',
        urlType: 'internal',
        items: [
          {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
          },
          (itemB = {
            content: 'Page B',
            url: '/the-component/1.0/page-b.html',
            urlType: 'internal',
            items: [
              (itemC = {
                content: 'The Page',
                url: '/the-component/1.0/the-page.html',
                urlType: 'internal',
              }),
              {
                content: 'Page D',
                url: '/the-component/1.0/page-d.html',
                urlType: 'internal',
              },
            ],
          }),
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.breadcrumbs).to.exist()
      expect(model.breadcrumbs).to.have.lengthOf(3)
      expect(model.breadcrumbs[0]).to.equal(menu[0])
      expect(model.breadcrumbs[1]).to.equal(itemB)
      expect(model.breadcrumbs[2]).to.equal(itemC)
    })

    it('should include non-link entry in breadcrumbs', () => {
      let category
      menu.push({
        order: 0,
        root: true,
        content: 'Nav Title',
        url: '/the-component/1.0/index.html',
        urlType: 'internal',
        items: [
          {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
          },
          (category = {
            content: 'Category B',
            items: [
              {
                content: 'The Page',
                url: '/the-component/1.0/the-page.html',
                urlType: 'internal',
              },
              {
                content: 'Page B',
                url: '/the-component/1.0/page-b.html',
                urlType: 'internal',
              },
            ],
          }),
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.breadcrumbs).to.include(category)
    })

    it('should drop first breadcrumb item if nav tree has no title', () => {
      menu.push({
        order: 0,
        root: true,
        items: [
          {
            content: 'The Page',
            url: '/the-component/1.0/the-page.html',
            urlType: 'internal',
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.breadcrumbs).to.exist()
      expect(model.breadcrumbs).to.have.lengthOf(1)
      expect(model.breadcrumbs[0]).to.equal(menu[0].items[0])
    })

    it('should create breadcrumb entry for current page if entry not found in any navigation tree', () => {
      file.asciidoc = { doctitle: 'The Page Title' }
      menu.push({
        order: 0,
        root: true,
        items: [
          {
            content: 'Not The Page',
            url: '/the-component/1.0/not-the-page.html',
            urlType: 'internal',
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.breadcrumbs).to.exist()
      expect(model.breadcrumbs).to.have.lengthOf(1)
      expect(model.breadcrumbs[0]).to.eql({
        content: 'The Page Title',
        url: file.pub.url,
        urlType: 'internal',
        discrete: true,
      })
    })

    it('should use breadcrumb path of first occurrence of page in nav tree', () => {
      let itemA
      let itemC1
      menu.push({
        order: 0,
        root: true,
        content: 'Nav Title',
        url: '/the-component/1.0/index.html',
        urlType: 'internal',
        items: [
          (itemA = {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
            items: [
              (itemC1 = {
                content: 'The Page',
                url: '/the-component/1.0/the-page.html',
                urlType: 'internal',
              }),
              {
                content: 'Page B',
                url: '/the-component/1.0/page-b.html',
                urlType: 'internal',
              },
            ],
          }),
          {
            content: 'The Page',
            url: '/the-component/1.0/the-page.html',
            urlType: 'internal',
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.breadcrumbs).to.exist()
      expect(model.breadcrumbs).to.have.lengthOf(3)
      expect(model.breadcrumbs[0]).to.equal(menu[0])
      expect(model.breadcrumbs[1]).to.equal(itemA)
      expect(model.breadcrumbs[2]).to.equal(itemC1)
    })

    it('should use breadcrumb path of first occurrence of page in any nav tree', () => {
      let itemC1
      menu.push({
        order: 0,
        root: true,
        content: 'First Nav Title',
        url: '/the-component/1.0/index.html',
        urlType: 'internal',
        items: [
          (itemC1 = {
            content: 'The Page',
            url: '/the-component/1.0/the-page.html',
            urlType: 'internal',
          }),
        ],
      })
      menu.push({
        order: 1,
        root: true,
        content: 'Second Nav Title',
        url: '/the-component/1.0/other.html',
        urlType: 'internal',
        items: [
          {
            content: 'The Page',
            url: '/the-component/1.0/the-page.html',
            urlType: 'internal',
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.breadcrumbs).to.exist()
      expect(model.breadcrumbs).to.have.lengthOf(2)
      expect(model.breadcrumbs[0]).to.equal(menu[0])
      expect(model.breadcrumbs[1]).to.equal(itemC1)
    })

    it('should find entry in navigation tree even when URL of all matching entries contain fragments', () => {
      let item1
      menu.push({
        order: 0,
        root: true,
        items: [
          (item1 = {
            content: 'The Page (top)',
            hash: '#_top',
            url: '/the-component/1.0/the-page.html#_top',
            urlType: 'internal',
            items: [
              {
                content: 'The Page (section)',
                hash: '#_section',
                url: '/the-component/1.0/the-page.html#_section',
                urlType: 'internal',
              },
              {
                content: 'Page B',
                url: '/the-component/1.0/page-b.html',
                urlType: 'internal',
              },
            ],
          }),
          {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.breadcrumbs).to.exist()
      expect(model.breadcrumbs).to.have.lengthOf(1)
      expect(model.breadcrumbs[0]).to.equal(item1)
    })

    it('should find entry in navigation tree even when URL of first matching entry contains a fragment', () => {
      let item1
      menu.push({
        order: 0,
        root: true,
        items: [
          (item1 = {
            content: 'The Page (section)',
            hash: '#_section',
            url: '/the-component/1.0/the-page.html#_section',
            urlType: 'internal',
            items: [
              {
                content: 'The Page',
                url: '/the-component/1.0/the-page.html',
                urlType: 'internal',
              },
              {
                content: 'Page B',
                url: '/the-component/1.0/page-b.html',
                urlType: 'internal',
              },
            ],
          }),
          {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.breadcrumbs).to.exist()
      expect(model.breadcrumbs).to.have.lengthOf(1)
      expect(model.breadcrumbs[0]).to.equal(item1)
    })

    it('should set next, previous, and parent references based on location of page in navigation tree', () => {
      let parent
      let previous
      let next
      menu.push({
        order: 0,
        root: true,
        content: 'Nav Title',
        url: '/the-component/1.0/index.html',
        urlType: 'internal',
        items: [
          {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
          },
          (parent = {
            content: 'Page B',
            url: '/the-component/1.0/page-b.html',
            urlType: 'internal',
            items: [
              (previous = {
                content: 'Page C',
                url: '/the-component/1.0/page-c.html',
                urlType: 'internal',
              }),
              {
                content: 'The Page',
                url: '/the-component/1.0/the-page.html',
                urlType: 'internal',
              },
              (next = {
                content: 'Page D',
                url: '/the-component/1.0/page-d.html',
                urlType: 'internal',
              }),
            ],
          }),
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.parent).to.exist()
      expect(model.parent).to.equal(parent)
      expect(model.previous).to.exist()
      expect(model.previous).to.equal(previous)
      expect(model.next).to.exist()
      expect(model.next).to.equal(next)
    })

    it('should skip over non-link entries when computing related page references', () => {
      let parent
      let previous
      let next
      menu.push(
        (parent = {
          order: 0,
          root: true,
          content: 'Nav Title',
          url: '/the-component/1.0/index.html',
          urlType: 'internal',
          items: [
            {
              content: 'Page A',
              url: '/the-component/1.0/page-a.html',
              urlType: 'internal',
            },
            {
              content: 'Category B',
              items: [
                (previous = {
                  content: 'Page C',
                  url: '/the-component/1.0/page-c.html',
                  urlType: 'internal',
                }),
                {
                  content: 'Text-only Entry',
                },
                {
                  content: 'The Page',
                  url: '/the-component/1.0/the-page.html',
                  urlType: 'internal',
                },
                {
                  content: 'Text-only Entry',
                },
                (next = {
                  content: 'Page D',
                  url: '/the-component/1.0/page-d.html',
                  urlType: 'internal',
                }),
              ],
            },
          ],
        })
      )
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.parent).to.exist()
      expect(model.parent).to.equal(parent)
      expect(model.previous).to.exist()
      expect(model.previous).to.equal(previous)
      expect(model.next).to.exist()
      expect(model.next).to.equal(next)
    })

    it('should skip over internal entries to same page when computing next page reference', () => {
      let parent
      let previous
      let next
      menu.push({
        order: 0,
        root: true,
        content: 'Nav Title',
        url: '/the-component/1.0/index.html',
        urlType: 'internal',
        items: [
          {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
          },
          (parent = {
            content: 'Category',
            url: '/the-component/1.0/category.html',
            urlType: 'internal',
            items: [
              (previous = {
                content: 'Section in Page C',
                hash: '#section',
                url: '/the-component/1.0/page-c.html#section',
                urlType: 'internal',
              }),
              {
                content: 'The Page',
                hash: '#overview',
                url: '/the-component/1.0/the-page.html#overview',
                urlType: 'internal',
              },
              {
                content: 'Section in The Page',
                hash: '#section',
                url: '/the-component/1.0/the-page.html#section',
                urlType: 'internal',
              },
              (next = {
                content: 'Page D',
                url: '/the-component/1.0/page-d.html',
                urlType: 'internal',
              }),
            ],
          }),
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.parent).to.exist()
      expect(model.parent).to.equal(parent)
      expect(model.previous).to.exist()
      expect(model.previous).to.equal(previous)
      expect(model.next).to.exist()
      expect(model.next).to.equal(next)
    })

    it('should skip over internal entries to same page when computing previous page reference', () => {
      let previous
      menu.push({
        order: 0,
        root: true,
        urlType: 'internal',
        items: [
          (previous = {
            content: 'Quickstart',
            url: '/the-component/1.0/quickstart.html',
            urlType: 'internal',
            items: [
              {
                content: 'Install A',
                hash: '#install-a',
                url: '/the-component/1.0/quickstart.html#install-a',
                urlType: 'internal',
              },
              {
                content: 'Install B',
                hash: '#install-b',
                url: '/the-component/1.0/quickstart.html#install-b',
                urlType: 'internal',
              },
              {
                content: 'The Page',
                url: '/the-component/1.0/the-page.html',
                urlType: 'internal',
              },
            ],
          }),
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.previous).to.exist()
      expect(model.previous).to.equal(previous)
    })

    it('should skip over external entries when computing related page references', () => {
      let parent
      let previous
      let next
      menu.push(
        (parent = {
          order: 0,
          root: true,
          content: 'Nav Title',
          url: '/the-component/1.0/index.html',
          urlType: 'internal',
          items: [
            {
              content: 'Page A',
              url: '/the-component/1.0/page-a.html',
              urlType: 'internal',
            },
            {
              content: 'External Link',
              url: 'https://example.com',
              urlType: 'external',
              items: [
                (previous = {
                  content: 'Page C',
                  url: '/the-component/1.0/page-c.html',
                  urlType: 'internal',
                }),
                {
                  content: 'Another External Link',
                  url: 'https://docs.example.com/getting-started/',
                  urlType: 'external',
                },
                {
                  content: 'The Page',
                  url: '/the-component/1.0/the-page.html',
                  urlType: 'internal',
                },
                {
                  content: 'Yet Another External Link',
                  url: 'https://help.example.com',
                  urlType: 'external',
                },
                (next = {
                  content: 'Page D',
                  url: '/the-component/1.0/page-d.html',
                  urlType: 'internal',
                }),
              ],
            },
          ],
        })
      )
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.parent).to.exist()
      expect(model.parent).to.equal(parent)
      expect(model.previous).to.exist()
      expect(model.previous).to.equal(previous)
      expect(model.next).to.exist()
      expect(model.next).to.equal(next)
    })

    it('should seek upwards in hierarchy to find adjacent related pages if current page has no sibling links', () => {
      let next
      let previous
      menu.push({
        order: 0,
        root: true,
        content: 'Nav Title',
        url: '/the-component/1.0/index.html',
        urlType: 'internal',
        items: [
          {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
          },
          (previous = {
            content: 'Page B',
            url: '/the-component/1.0/page-b.html',
            urlType: 'internal',
            items: [
              {
                content: 'Text-only Before',
              },
              {
                content: 'The Page',
                url: '/the-component/1.0/the-page.html',
                urlType: 'internal',
              },
              {
                content: 'Text-only After',
              },
            ],
          }),
          (next = {
            content: 'Page C',
            url: '/the-component/1.0/page-c.html',
            urlType: 'internal',
          }),
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.next).to.exist()
      expect(model.next).to.equal(next)
      expect(model.previous).to.exist()
      expect(model.previous).to.equal(previous)
    })

    it('should set next property for start page if not found in navigation tree', () => {
      file.path = file.src.path = 'modules/ROOT/pages/' + (file.relative = 'index.adoc')
      file.pub.url = '/the-component/1.0/index.html'
      let next
      menu.push({
        order: 0,
        root: true,
        items: [
          {
            content: 'Category',
            items: [
              (next = {
                content: 'Page A',
                url: '/the-component/1.0/page-a.html',
                urlType: 'internal',
              }),
            ],
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.next).to.exist()
      expect(model.next).to.equal(next)
      expect(model.previous).to.not.exist()
      expect(model.parent).to.not.exist()
    })

    it('should set previous property to start page for first item in navigation tree', () => {
      const prev = { content: component.title, url: component.url, urlType: 'internal', discrete: true }
      menu.push({
        order: 0,
        root: true,
        items: [
          {
            content: 'The Page',
            url: '/the-component/1.0/the-page.html',
            urlType: 'internal',
          },
          {
            content: 'Page A',
            url: '/the-component/1.0/page-a.html',
            urlType: 'internal',
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.previous).to.exist()
      expect(model.previous).to.eql(prev)
    })

    it('should not set next property for start page to current page', () => {
      file.path = file.src.path = 'modules/ROOT/pages/' + (file.relative = 'index.adoc')
      file.pub.url = '/the-component/1.0/index.html'
      let next
      menu.push({
        order: 0,
        root: true,
        items: [
          {
            content: 'Section in Start Page',
            hash: '#overview',
            url: file.pub.url + '#overview',
            urlType: 'internal',
            items: [
              (next = {
                content: 'Page A',
                url: '/the-component/1.0/page-a.html',
                urlType: 'internal',
              }),
            ],
          },
        ],
      })
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.next).to.exist()
      expect(model.next).to.equal(next)
      expect(model.previous).to.not.exist()
      expect(model.parent).to.not.exist()
    })

    it('should not set versions property if component only has one version', () => {
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.versions).to.not.exist()
    })

    it('should set versions property based on versions of page from catalog', () => {
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.push({
        version: '1.0-beta',
        title: 'The Component',
        url: '/the-component/1.0-beta/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      const files = {
        '1.0-beta': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '1.0-beta',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/1.0-beta/the-page.html',
          },
        },
        '1.0': file,
        '2.0': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/2.0/the-page.html',
          },
        },
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        path: 'modules/ROOT/pages/the-page.adoc',
        component: 'the-component',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        version: '2.0',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        path: 'modules/ROOT/pages/the-page.adoc',
        component: 'the-component',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        version: '1.0-beta',
      })
      expect(model.versions).to.exist()
      expect(model.versions).to.have.lengthOf(3)
      expect(model.versions).to.eql([
        { latest: true, version: '2.0', title: 'The Component', url: '/the-component/2.0/the-page.html' },
        { version: '1.0', displayVersion: 'Io', title: 'The Component', url: '/the-component/1.0/the-page.html' },
        { version: '1.0-beta', title: 'The Component', url: '/the-component/1.0-beta/the-page.html' },
      ])
      expect(model.latest).to.eql(model.versions[0])
    })

    it('should follow alias when looking for newer versions of page', () => {
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.unshift({
        version: '3.0',
        title: 'The Component',
        url: '/the-component/3.0/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      let rel
      const files = {
        '1.0': [file],
        '2.0': [
          (rel = {
            src: {
              family: 'page',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-component/2.0/the-new-page.html',
            },
          }),
          {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-page.adoc',
            },
            rel,
          },
        ],
        '3.0': [
          {
            src: {
              family: 'page',
              component: 'the-component',
              version: '3.0',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-component/3.0/the-new-page.html',
            },
          },
        ],
      }
      contentCatalog.getById = (filter) =>
        files[filter.version].find(({ src }) => filter.family === src.family && filter.relative === src.relative)
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.versions).to.exist()
      expect(model.versions).to.have.lengthOf(3)
      expect(model.versions).to.eql([
        { latest: true, version: '3.0', title: 'The Component', url: '/the-component/3.0/the-new-page.html' },
        { version: '2.0', title: 'The Component', url: '/the-component/2.0/the-new-page.html' },
        { version: '1.0', displayVersion: 'Io', title: 'The Component', url: '/the-component/1.0/the-page.html' },
      ])
      expect(model.latest).to.eql(model.versions[0])
    })

    it('should not follow alias outside component version when looking for new versions of page', () => {
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.unshift({
        version: '3.0',
        title: 'The Component',
        url: '/the-component/3.0/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      const rel = {
        src: {
          family: 'page',
          component: 'other-component',
          version: '1.5',
          module: 'ROOT',
          relative: 'somewhere.adoc',
        },
        pub: {
          url: '/other-component/1.5/somewhere.html',
        },
      }
      const files = {
        '1.0': [file],
        '2.0': [
          {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-page.adoc',
            },
            rel,
          },
        ],
        '3.0': [],
      }
      contentCatalog.getById = (filter) =>
        files[filter.version].find(({ src }) => filter.family === src.family && filter.relative === src.relative)
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.versions).to.exist()
      expect(model.versions).to.have.lengthOf(3)
      expect(model.versions).to.eql([
        { latest: true, missing: true, version: '3.0', title: 'The Component', url: '/the-component/3.0/index.html' },
        { version: '2.0', title: 'The Component', url: '/other-component/1.5/somewhere.html' },
        { version: '1.0', displayVersion: 'Io', title: 'The Component', url: '/the-component/1.0/the-page.html' },
      ])
      expect(model.latest).to.eql(model.versions[0])
    })

    it('should trace back primary alias when looking for older versions of page', () => {
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.unshift({
        version: '3.0',
        title: 'The Component',
        url: '/the-component/3.0/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      let rel
      let alias
      const files = {
        '1.0': [file],
        '2.0': [
          (rel = {
            src: {
              family: 'page',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-component/2.0/the-new-page.html',
            },
          }),
          (alias = {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-page.adoc',
            },
            rel,
          }),
        ],
        '3.0': [
          {
            src: {
              family: 'page',
              component: 'the-component',
              version: '3.0',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-component/3.0/the-new-page.html',
            },
          },
        ],
      }
      // rel is set on the alias target by ContentCatalog#registerPageAlias
      rel.rel = alias
      file = files['3.0'][0]
      contentCatalog.getById = (filter) =>
        files[filter.version].find(({ src }) => filter.family === src.family && filter.relative === src.relative)
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.versions).to.exist()
      expect(model.versions).to.have.lengthOf(3)
      expect(model.versions).to.eql([
        { latest: true, version: '3.0', title: 'The Component', url: '/the-component/3.0/the-new-page.html' },
        { version: '2.0', title: 'The Component', url: '/the-component/2.0/the-new-page.html' },
        { version: '1.0', displayVersion: 'Io', title: 'The Component', url: '/the-component/1.0/the-page.html' },
      ])
      expect(model.latest).to.eql(model.versions[0])
    })

    it('should not resolve primary alias if it falls outside component version when looking for older versions of page', () => {
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.unshift({
        version: '3.0',
        title: 'The Component',
        url: '/the-component/3.0/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      let rel
      let alias
      const files = {
        '1.0': [file],
        '2.0': [
          (rel = {
            src: {
              family: 'page',
              component: 'the-other-component',
              version: 'master',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-other-component/the-new-page.html',
            },
          }),
          (alias = {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-page.adoc',
            },
            rel,
          }),
        ],
        '3.0': [
          {
            src: {
              family: 'page',
              component: 'the-component',
              version: '3.0',
              module: 'ROOT',
              relative: 'the-page.adoc',
            },
            pub: {
              url: '/the-component/3.0/the-page.html',
            },
          },
        ],
      }
      // rel is set on the alias target by ContentCatalog#registerPageAlias
      rel.rel = alias
      file = files['3.0'][0]
      contentCatalog.getById = (filter) =>
        files[filter.version].find(({ src }) => filter.family === src.family && filter.relative === src.relative)
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.versions).to.exist()
      expect(model.versions).to.have.lengthOf(3)
      expect(model.versions).to.eql([
        { latest: true, version: '3.0', title: 'The Component', url: '/the-component/3.0/the-page.html' },
        { missing: true, version: '2.0', title: 'The Component', url: '/the-component/2.0/index.html' },
        // notice how it finds the 1.0 version again (after not tracing the alias in 2.0)
        { version: '1.0', displayVersion: 'Io', title: 'The Component', url: '/the-component/1.0/the-page.html' },
      ])
      expect(model.latest).to.eql(model.versions[0])
    })

    it('should stop tracing primary alias if it falls outside component version when looking for older versions of page', () => {
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.unshift({
        version: '2.1',
        title: 'The Component',
        url: '/the-component/2.1/index.html',
      })
      component.versions.unshift({
        version: '3.0',
        title: 'The Component',
        url: '/the-component/3.0/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      let rel1
      let alias1
      let rel2
      let alias2
      let alias3
      const files = {
        '1.0': [
          file,
          (alias3 = {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '1.0',
              module: 'ROOT',
              relative: 'the-paje.adoc',
            },
            rel: file,
          }),
        ],
        '2.0': [
          {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-interim-page.adoc',
            },
            rel: {
              src: {
                family: 'page',
                component: 'other-component',
                version: '1.0',
                module: 'ROOT',
                relative: 'prospector.adoc',
              },
              pub: {
                url: '/other-component/1.0/prospector.html',
              },
            },
          },
        ],
        2.1: [
          (rel2 = {
            src: {
              family: 'page',
              component: 'the-component',
              version: '2.1',
              module: 'ROOT',
              relative: 'the-paje.adoc',
            },
            pub: {
              url: '/the-component/2.1/the-paje.html',
            },
          }),
          (alias2 = {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '2.1',
              module: 'ROOT',
              relative: 'the-interim-page.adoc',
            },
            rel: rel2,
          }),
        ],
        '3.0': [
          (rel1 = {
            src: {
              family: 'page',
              component: 'the-component',
              version: '3.0',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-component/3.0/the-new-page.html',
            },
          }),
          (alias1 = {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '3.0',
              module: 'ROOT',
              relative: 'the-interim-page.adoc',
            },
            rel: rel1,
          }),
          {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '3.0',
              module: 'other',
              relative: 'another-has-been.adoc',
            },
          },
        ],
      }
      // rel is set on the alias target by ContentCatalog#registerPageAlias
      rel1.rel = alias1
      rel2.rel = alias2
      file.rel = alias3
      file = files['3.0'][0]
      contentCatalog.getById = (filter) =>
        files[filter.version].find(({ src }) => filter.family === src.family && filter.relative === src.relative)
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.versions).to.exist()
      expect(model.versions).to.have.lengthOf(4)
      expect(model.versions).to.eql([
        { latest: true, version: '3.0', title: 'The Component', url: '/the-component/3.0/the-new-page.html' },
        { version: '2.1', title: 'The Component', url: '/the-component/2.1/the-paje.html' },
        { version: '2.0', title: 'The Component', url: '/other-component/1.0/prospector.html' },
        // it does not find the last concrete alias because that information is not maintained
        {
          missing: true,
          version: '1.0',
          displayVersion: 'Io',
          title: 'The Component',
          url: '/the-component/1.0/index.html',
        },
      ])
      expect(model.latest).to.eql(model.versions[0])
    })

    it('should propagate prerelease and display version from component version to page version', () => {
      component.versions.unshift({
        version: '2.0',
        prerelease: 'Beta',
        displayVersion: '2.0 Beta',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.latest = component.versions[1]
      component.url = component.latest.url
      const files = {
        '1.0': file,
        '2.0': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/2.0/the-page.html',
          },
        },
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        path: 'modules/ROOT/pages/the-page.adoc',
        component: 'the-component',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        version: '2.0',
      })
      expect(model.versions).to.exist()
      expect(model.versions).to.have.lengthOf(2)
      expect(model.versions).to.eql([
        {
          version: '2.0',
          displayVersion: '2.0 Beta',
          prerelease: 'Beta',
          title: 'The Component',
          url: '/the-component/2.0/the-page.html',
        },
        {
          latest: true,
          version: '1.0',
          displayVersion: 'Io',
          title: 'The Component',
          url: '/the-component/1.0/the-page.html',
        },
      ])
      expect(model.latest).to.eql(model.versions[1])
    })

    it('should add sparse entry in value of versions property if page is missing for version', () => {
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.push({
        version: '1.0-beta',
        title: 'The Component',
        url: '/the-component/1.0-beta/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      const files = {
        '1.0': file,
        '2.0': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/2.0/the-page.html',
          },
        },
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        path: 'modules/ROOT/pages/the-page.adoc',
        component: 'the-component',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        version: '2.0',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        path: 'modules/ROOT/pages/the-page.adoc',
        component: 'the-component',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
        version: '1.0-beta',
      })
      expect(model.versions).to.exist()
      expect(model.versions).to.have.lengthOf(3)
      expect(model.versions).to.eql([
        { latest: true, version: '2.0', title: 'The Component', url: '/the-component/2.0/the-page.html' },
        { version: '1.0', displayVersion: 'Io', title: 'The Component', url: '/the-component/1.0/the-page.html' },
        { version: '1.0-beta', title: 'The Component', url: '/the-component/1.0-beta/index.html', missing: true },
      ])
    })

    it('should set canonicalUrl property to url of latest version', () => {
      site.url = 'http://example.com'
      component.versions.unshift({
        version: '2.0',
        prerelease: true,
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.latest = component.versions[1]
      const files = {
        '1.0': file,
        '2.0': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/2.0/the-page.html',
          },
        },
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.exist()
      expect(model.canonicalUrl).to.equal('http://example.com/the-component/1.0/the-page.html')
    })

    it('should follow alias through to latest version when resolving canonicalUrl property', () => {
      site.url = 'http://example.com'
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.unshift({
        version: '3.0',
        title: 'The Component',
        url: '/the-component/3.0/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      let rel
      const files = {
        '1.0': [file],
        '2.0': [
          (rel = {
            src: {
              family: 'page',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-component/2.0/the-new-page.html',
            },
          }),
          {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-page.adoc',
            },
            rel,
          },
        ],
        '3.0': [
          {
            src: {
              family: 'page',
              component: 'the-component',
              version: '3.0',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-component/3.0/the-new-page.html',
            },
          },
        ],
      }
      contentCatalog.getById = (filter) =>
        files[filter.version].find(({ src }) => filter.family === src.family && filter.relative === src.relative)
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.exist()
      expect(model.canonicalUrl).to.equal('http://example.com/the-component/3.0/the-new-page.html')
    })

    it('should follow alias in latest version when resolving canonicalUrl property', () => {
      site.url = 'http://example.com'
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.versions.unshift({
        version: '3.0',
        title: 'The Component',
        url: '/the-component/3.0/index.html',
      })
      component.latest = component.versions[0]
      component.url = component.latest.url
      let rel
      const files = {
        '1.0': [file],
        '2.0': [
          {
            src: {
              family: 'page',
              component: 'the-component',
              version: '2.0',
              module: 'ROOT',
              relative: 'the-page.adoc',
            },
            pub: {
              url: '/the-component/2.0/the-page.html',
            },
          },
        ],
        '3.0': [
          (rel = {
            src: {
              family: 'page',
              component: 'the-component',
              version: '3.0',
              module: 'ROOT',
              relative: 'the-new-page.adoc',
            },
            pub: {
              url: '/the-component/3.0/the-new-page.html',
            },
          }),
          {
            src: {
              family: 'alias',
              component: 'the-component',
              version: '3.0',
              module: 'ROOT',
              relative: 'the-page.adoc',
            },
            rel,
          },
        ],
      }
      contentCatalog.getById = (filter) =>
        files[filter.version].find(({ src }) => filter.family === src.family && filter.relative === src.relative)
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.exist()
      expect(model.canonicalUrl).to.equal('http://example.com/the-component/3.0/the-new-page.html')
    })

    it('should not set canonicalUrl property to url newer than latest version', () => {
      site.url = 'http://example.com'
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.latest = component.versions[1]
      const files = {
        '1.0': file,
        '2.0': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/2.0/the-page.html',
          },
        },
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.exist()
      expect(model.canonicalUrl).to.equal('http://example.com/the-component/1.0/the-page.html')
    })

    it('should not set canonicalUrl property if page only exists in prerelease version', () => {
      site.url = 'http://example.com'
      component.versions.unshift({
        version: '2.0',
        prerelease: '-beta.1',
        title: 'The Component',
        url: '/the-component/2.0/new-page.html',
      })
      component.latest = component.versions[1]
      const files = {
        '2.0': (file = {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/new-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/2.0/new-page.html',
          },
        }),
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.be.undefined()
    })

    it('should set canonicalUrl property to url of most recent version in which page exists', () => {
      site.url = 'http://example.com'
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.latest = component.versions[0]
      const files = { '1.0': file }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.exist()
      expect(model.canonicalUrl).to.equal('http://example.com/the-component/1.0/the-page.html')
    })

    it('should set canonicalUrl property to url of most recent version in which page exists starting from latest', () => {
      site.url = 'http://example.com'
      component.versions.unshift({
        version: '1.5',
        title: 'The Component',
        url: '/the-component/1.5/index.html',
      })
      component.versions.unshift({
        version: '2.0',
        prerelease: '-beta.1',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.latest = component.versions[1]
      const files = {
        '1.0': (file = {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/resurrected-page.adoc',
            component: 'the-component',
            version: '1.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/1.0/resurrected-page.html',
          },
        }),
        '2.0': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/resurrected-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/2.0/resurrected-page.html',
          },
        },
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.exist()
      expect(model.canonicalUrl).to.equal('http://example.com/the-component/1.0/resurrected-page.html')
    })

    it('should not set canonicalUrl property if site url is not absolute', () => {
      site.url = '/docs'
      component.versions.unshift({
        latest: true,
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      const files = { '1.0': file }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.not.exist()
    })

    it('should not prepend site url to canonicalUrl property if page url is absolute', () => {
      site.url = 'http://archive.docs.example.com'
      component.versions.unshift({
        version: '2.0',
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.latest = component.versions[0]
      const files = {
        '1.0': file,
        '2.0': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: 'http://example.com/the-component/2.0/the-page.html',
          },
        },
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.exist()
      expect(model.canonicalUrl).to.equal('http://example.com/the-component/2.0/the-page.html')
    })

    it('should not set canonicalUrl property if all versions are prereleases', () => {
      site.url = 'http://example.com'
      component.versions[0].prerelease = true
      component.versions.unshift({
        version: '2.0',
        prerelease: true,
        title: 'The Component',
        url: '/the-component/2.0/index.html',
      })
      component.latest = component.versions[0]
      const files = {
        '1.0': file,
        '2.0': {
          src: {
            family: 'page',
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '2.0',
            module: 'ROOT',
          },
          pub: {
            url: '/the-component/2.0/the-page.html',
          },
        },
      }
      contentCatalog.getById = spy((filter) => files[filter.version])
      contentCatalogModel.getById = contentCatalog.getById.bind(contentCatalog)
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.canonicalUrl).to.not.exist()
    })

    it('should not set canonicalUrl property if only versions is a prerelease', () => {
      site.url = 'http://example.com'
      component.latest = component.versions[0]
      component.versions[0].prerelease = true
      const model = buildPageUiModel(site, file, contentCatalogModel, navigationCatalog)
      expect(model.versions).to.not.exist()
      expect(model.canonicalUrl).to.not.exist()
    })
  })

  describe('buildUiModel()', () => {
    let baseUiModel

    beforeEach(() => {
      baseUiModel = {
        site: {
          ui: {
            url: '/_',
          },
        },
        contentCatalog: contentCatalogModel,
      }
    })

    it('should create model from base UI model', () => {
      const model = buildUiModel(baseUiModel, file, baseUiModel.contentCatalog, navigationCatalog)
      expect(model.site).to.exist()
      expect(model.site).to.equal(baseUiModel.site)
      expect(model.contentCatalog).to.exist()
      expect(model.contentCatalog).to.equal(baseUiModel.contentCatalog)
      expect(model.page).to.exist()
      expect(model).to.not.equal(baseUiModel)
    })

    it('should compute and set page property', () => {
      const model = buildUiModel(baseUiModel, file, baseUiModel.contentCatalog, navigationCatalog)
      expect(model.page).to.exist()
      const pageModel = buildPageUiModel(baseUiModel.site, file, baseUiModel.contentCatalog, navigationCatalog)
      expect(model.page).to.deep.equal(pageModel)
      expect(model.page.url).to.equal(file.pub.url)
    })

    it('should set siteRootPath property to pub.rootPath of file', () => {
      const model = buildUiModel(baseUiModel, file, baseUiModel.contentCatalog, navigationCatalog)
      expect(model.siteRootPath).to.exist()
      expect(model.siteRootPath).to.equal(file.pub.rootPath)
    })

    it('should set uiRootPath property relative to page', () => {
      const model = buildUiModel(baseUiModel, file, baseUiModel.contentCatalog, navigationCatalog)
      expect(model.uiRootPath).to.exist()
      expect(model.uiRootPath).to.equal('../../_')
    })
  })
})

/* eslint-env mocha */
'use strict'

const { captureLogSync, expect, heredoc, spy } = require('@antora/test-harness')

const createPageComposer = require('@antora/page-composer')
const { version: VERSION } = require('@antora/page-composer/package.json')

describe('createPageComposer()', () => {
  let contentCatalog
  let helpers
  let layouts
  let partials
  let playbook
  let uiCatalog

  const defineHelper = (stem, contents, path) => {
    contents = 'module.exports = ' + contents
    helpers.push({ contents: Buffer.from(contents + '\n'), path: path || `helpers/${stem}.js`, stem })
  }

  const defineLayout = (stem, contents, path) => {
    layouts.push({ contents: Buffer.from(contents + '\n'), path: path || `layouts/${stem}.hbs`, stem })
  }

  const definePartial = (stem, contents, path) => {
    partials.push({ contents: Buffer.from(contents + '\n'), path: path || `partials/${stem}.hbs`, stem })
  }

  const replaceCallToBodyPartial = (replacement) => {
    const defaultLayout = layouts.find((layout) => layout.stem === 'default')
    defaultLayout.contents = Buffer.from(defaultLayout.contents.toString().replace('{{> body}}', replacement))
  }

  beforeEach(() => {
    playbook = {
      site: {
        title: 'Docs Site',
      },
      ui: {
        outputDir: '_/',
      },
    }

    helpers = [
      {
        stem: 'upper',
        contents: Buffer.from(
          heredoc`
          module.exports = (str) => str.toUpperCase()
          ` + '\n'
        ),
      },
      {
        stem: 'eq',
        contents: Buffer.from(
          heredoc`
          module.exports = (a, b) => a === b
          ` + '\n'
        ),
      },
      {
        stem: 'get-the-page',
        contents: Buffer.from(
          heredoc`
          module.exports = function ({ data: { root } }) { return root.contentCatalog.getById({ version: '0.9' }) }
          ` + '\n'
        ),
      },
    ]

    layouts = [
      {
        stem: 'default',
        contents: Buffer.from(
          heredoc`
          <!DOCTYPE html>
          <html class="default">
          {{> head}}
          {{> body}}
          </html>
          ` + '\n'
        ),
      },
      {
        stem: 'chapter',
        contents: Buffer.from(
          heredoc`
          <!DOCTYPE html>
          <html class="chapter">
          {{> head}}
          {{> body}}
          </html>
          ` + '\n'
        ),
      },
    ]

    partials = [
      {
        stem: 'head',
        contents: Buffer.from(
          heredoc`
          <title>{{page.title}}</title>
          {{#if page.description}}
          <meta name="description" content="{{page.description}}">
          {{/if}}
          ` + '\n'
        ),
      },
      {
        stem: 'body',
        contents: Buffer.from(
          heredoc`
          <article>
            <h1>{{{page.title}}}</h1>
            {{{page.contents}}}
          </article>
          ` + '\n'
        ),
      },
      {
        stem: 'body-upper-title',
        contents: Buffer.from(
          heredoc`
          <h1>{{{upper page.title}}}</h1>
          {{{page.contents}}}
          ` + '\n'
        ),
      },
      {
        stem: 'the-component',
        contents: Buffer.from(
          heredoc`
          {{#each site.components}}
          {{#if (eq . @root.page.component)}}
          <p>The current component is {{./name}}.</p>
          {{/if}}
          {{/each}}
          ` + '\n'
        ),
      },
      {
        stem: 'body-undefined-property-reference',
        contents: Buffer.from(
          heredoc`
          {{#unless page.noSuchThang.name}}
          <p>No such thang.</p>
          {{/unless}}
          ` + '\n'
        ),
      },
    ]

    contentCatalog = {
      getComponentsSortedBy: (property) => [],
      getSiteStartPage: () => undefined,
      exportToModel: spy(() => ({
        getComponentsSortedBy: contentCatalog.getComponentsSortedBy,
        getSiteStartPage: contentCatalog.getSiteStartPage,
      })),
    }

    uiCatalog = {
      findByType: spy((type) => {
        if (type === 'layout') return layouts
        if (type === 'partial') return partials
        if (type === 'helper') return helpers
      }),
    }
  })

  it('should create a page composer function that uses isolated handlebars environment', () => {
    const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
    expect(composePage).to.be.instanceOf(Function)
    expect(composePage.composePage).to.equal(composePage)
    expect(composePage).to.have.property('handlebars')
    const handlebars = composePage.handlebars
    expect(handlebars.helpers).to.have.property('relativize')
    expect(handlebars.layouts).to.have.property('default')
    expect(handlebars.partials).to.have.property('head')
    const defaultHandlebars = require('handlebars')
    expect(defaultHandlebars.helpers).to.not.have.property('relativize')
    expect(defaultHandlebars).to.not.have.property('layouts')
    expect(defaultHandlebars.partials).to.be.empty()
  })

  it('should create a 404 page creator function', () => {
    const { create404Page } = createPageComposer(playbook, contentCatalog, uiCatalog)
    expect(create404Page).to.be.instanceOf(Function)
  })

  it('should use exported content catalog', () => {
    createPageComposer(playbook, contentCatalog, uiCatalog)
    expect(contentCatalog.exportToModel).to.have.been.called.once()
  })

  it('should operate on helper, partial, and layout files from UI catalog', () => {
    createPageComposer(playbook, contentCatalog, uiCatalog)
    const types = uiCatalog.findByType.__spy.calls.map((call) => call[0]).sort((a, b) => a.localeCompare(b, 'en'))
    expect(types).to.eql(['helper', 'layout', 'partial'])
  })

  it('should drop subdirectory in partials, layouts, and helpers', () => {
    defineHelper('trim', '(str) => str.trim()', 'helpers/not-used/trim.js')
    defineLayout('bare', '<!DOCTYPE html>\n{{> page-contents}}', 'layouts/not-used/bare.hbs')
    definePartial('page-contents', '{{{page.contents}}}', 'partials/not-used/page-contents.hbs')
    const { handlebars } = createPageComposer(playbook, contentCatalog, uiCatalog)
    expect(handlebars.helpers).to.have.property('trim')
    expect(handlebars.layouts).to.have.property('bare')
    expect(handlebars.partials).to.have.property('page-contents')
  })

  describe('composePage()', () => {
    let component
    let components
    let file
    let files
    let menu
    let navigationCatalog

    beforeEach(() => {
      component = {
        name: 'the-component',
        title: 'The Component',
        url: '/the-component/1.0/index.html',
        versions: [
          {
            version: '1.0',
            title: 'The Component',
            url: '/the-component/1.0/index.html',
          },
          {
            version: '0.9',
            title: 'The Component',
            url: '/the-component/0.9/index.html',
          },
        ],
      }

      component.latest = component.versions[0]

      components = [component]

      files = {
        0.9: {
          contents: Buffer.from('<p>the contents</p>'),
          src: {
            path: 'modules/ROOT/pages/the-page.adoc',
            component: 'the-component',
            version: '0.9',
            module: 'ROOT',
            relative: 'the-page.adoc',
          },
          pub: {
            url: '/the-component/0.9/the-page.html',
            rootPath: '../..',
          },
          asciidoc: {
            doctitle: 'The Page',
            attributes: {
              description: 'The description of the page.',
            },
          },
        },
        '1.0': (file = {
          contents: Buffer.from('<p>the contents</p>'),
          src: {
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
          asciidoc: {
            doctitle: 'The Page',
            attributes: {
              description: 'The description of the page.',
            },
          },
        }),
      }

      contentCatalog = {
        getById: ({ version }) => files[version],
        getComponent: (name) => component,
        getComponentVersion: (component, version) => {
          if (!component.versions) component = this.getComponent(component)
          return component.versions.find((candidate) => candidate.version === version)
        },
        getComponentsSortedBy: (property) => components.slice(0).sort((a, b) => a[property].localeCompare(b[property])),
        getPages: () => files,
        getSiteStartPage: () => undefined,
        resolvePage: (spec, { component, version }) => {
          if (!spec) {
            throw new Error('invalid page ID')
          } else if (spec === 'the-component::the-page.adoc') {
            return files['1.0']
          } else if (spec === 'the-page.adoc' && component === 'the-component') {
            return version === '0.9' ? files['0.9'] : files['1.0']
          }
        },
      }

      contentCatalog.exportToModel = () => ({
        getById: contentCatalog.getById,
        getComponent: contentCatalog.getComponent,
        getComponentVersion: contentCatalog.getComponentVersion,
        getComponentsSortedBy: contentCatalog.getComponentsSortedBy,
        getPages: contentCatalog.getPages,
        getSiteStartPage: contentCatalog.getSiteStartPage,
        resolvePage: contentCatalog.resolvePage,
      })

      menu = []

      navigationCatalog = {
        getNavigation: (name, version) => menu,
      }
    })

    it('should execute the default template against the UI model', () => {
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      const result = composePage(file, contentCatalog, navigationCatalog)
      expect(result).to.equal(file)
      expect(file.contents).to.be.instanceOf(Buffer)
      expect(file.contents.toString()).to.endWith('\n')
      expect(file.contents.toString().trimEnd()).to.equal(heredoc`
        <!DOCTYPE html>
        <html class="default">
        <title>The Page</title>
        <meta name="description" content="The description of the page.">
        <article>
          <h1>The Page</h1>
          <p>the contents</p>
        </article>
        </html>
      `)
    })

    it('should apply helper function to template variable', () => {
      replaceCallToBodyPartial('{{> body-upper-title}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<h1>THE PAGE</h1>')
    })

    it('should not indent preformatted content', () => {
      replaceCallToBodyPartial('  {{> body}}')
      file.contents = Buffer.from(heredoc`
        <pre>a
        b
        c</pre>
      `)
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<pre>a\nb\nc</pre>')
    })

    it('should be able to compare component with entry in component list for equality', () => {
      replaceCallToBodyPartial('{{> the-component}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>The current component is the-component.</p>')
    })

    it('should be able to include a dynamic partial', () => {
      replaceCallToBodyPartial('{{> (lookup page.component "name")}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>The current component is the-component.</p>')
    })

    it('should be able to access a property that is not defined', () => {
      replaceCallToBodyPartial('{{> body-undefined-property-reference}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>No such thang.</p>')
    })

    it('should be able to access the Antora version', () => {
      replaceCallToBodyPartial('<body>{{antoraVersion}}</body>')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include(`<body>${VERSION}</body>`)
    })

    it('should be able to reference the provided environment variables using the env variable', () => {
      playbook.env = { FOO: 'BAR' }
      replaceCallToBodyPartial('<body>{{env.FOO}}</body>')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<body>BAR</body>')
    })

    it('should be able to reference properties of site', () => {
      replaceCallToBodyPartial('<body>{{site.url}}</body>')
      playbook.site.url = 'https://docs.example.org/site'
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<body>https://docs.example.org/site</body>')
    })

    it('should use default layout specified in playbook', () => {
      playbook.ui.defaultLayout = 'chapter'
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<html class="chapter">')
    })

    it('should use the layout specified by page-layout attribute on file', () => {
      file.asciidoc.attributes['page-layout'] = 'chapter'
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<html class="chapter">')
    })

    it('should use default layout if layout specified in page-layout attribute does not exist', () => {
      file.asciidoc.attributes['page-layout'] = 'does-not-exist'
      file.src.origin = {
        type: 'git',
        refname: 'main',
        startPath: 'docs',
        url: 'https://git.example.org/repo.git',
      }
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      const messages = captureLogSync(() => composePage(file, contentCatalog, navigationCatalog))
      expect(file.contents.toString()).to.include('<html class="default">')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'warn',
        name: '@antora/page-composer',
        msg: 'Page layout specified by page not found: does-not-exist (reverting to default layout)',
        file: {
          path: 'docs/modules/ROOT/pages/the-page.adoc',
        },
        source: {
          refname: 'main',
          reftype: 'branch',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
        },
      })
    })

    // QUESTION should this be checked in the function generator?
    it('should throw an error if default layout cannot be found', () => {
      playbook.ui.defaultLayout = 'does-not-exist'
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      expect(() => composePage(file, contentCatalog, navigationCatalog)).to.throw(/does-not-exist layout not found/i)
    })

    it('should throw an error if layout specified in page-layout attribute does not exist and is default', () => {
      playbook.ui.defaultLayout = 'also-does-not-exist'
      file.asciidoc.attributes['page-layout'] = 'does-not-exist'
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      expect(() => composePage(file, contentCatalog, navigationCatalog)).to.throw(/neither .* layout .* found/i)
    })

    it('should be able to access content catalog from helper', () => {
      definePartial(
        'body-get-the-page',
        heredoc`
        {{#with (get-the-page)}}
        <p>{{./pub.url}}</p>
        {{/with}}
        `
      )
      replaceCallToBodyPartial('{{> body-get-the-page}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>/the-component/0.9/the-page.html</p>')
    })

    it('should be able to call built-in helper to resolve page', () => {
      definePartial(
        'body-resolve-page',
        heredoc`
        {{#with (resolvePage 'the-component::the-page.adoc')}}
        <p>{{./url}} matches {{./latest.url}}</p>
        {{/with}}
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include(
        '<p>/the-component/1.0/the-page.html matches /the-component/1.0/the-page.html</p>'
      )
    })

    it('should be able to call built-in helper to resolve URL of page', () => {
      definePartial(
        'body-resolve-page-url',
        heredoc`
        <p>{{resolvePageURL 'the-component::the-page.adoc'}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-url}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>/the-component/1.0/the-page.html</p>')
    })

    it('should not crash when calling built-in helper to resolve page if spec is falsy', () => {
      definePartial(
        'body-resolve-page-falsy',
        heredoc`
        {{#with (resolvePage page.attributes.no-such-page)}}
        <p>{{./url}}</p>
        {{else}}
        <p>no such page</p>
        {{/with}}
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-falsy}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>no such page</p>')
    })

    it('should not crash when calling built-in helper to resolve page URL if spec is falsy', () => {
      definePartial(
        'body-resolve-page-url-falsy',
        heredoc`
        <p>{{resolvePageURL page.attributes.no-such-page}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-url-falsy}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p></p>')
    })

    it('should be able to instruct resolvePage helper to not convert return value to page model', () => {
      definePartial(
        'body-resolve-page',
        heredoc`
        {{#with (resolvePage 'the-component::the-page.adoc' model=false)}}
        <p>{{./pub.url}}</p>
        {{/with}}
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>/the-component/1.0/the-page.html</p>')
    })

    it('should be able to call built-in helper to resolve page inside #with block', () => {
      definePartial(
        'body-resolve-page-inside-with',
        heredoc`
        {{#with page.component}}
        {{#with (resolvePage 'the-component::the-page.adoc' model=true)}}
        <p>{{./url}} matches {{./latest.url}}</p>
        {{/with}}
        {{/with}}
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-inside-with}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include(
        '<p>/the-component/1.0/the-page.html matches /the-component/1.0/the-page.html</p>'
      )
    })

    it('should be able to call built-in helper to resolve URL of page inside #with block', () => {
      definePartial(
        'body-resolve-page-url-inside-with',
        heredoc`
        {{#with page.component}}
        <p>{{resolvePageURL 'the-component::the-page.adoc'}}</p>
        {{/with}}
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-url-inside-with}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>/the-component/1.0/the-page.html</p>')
    })

    it('should be able to call built-in helper with context to resolve page', () => {
      definePartial(
        'body-resolve-page-from-context',
        heredoc`
        {{#with (resolvePage 'the-page.adoc' version='0.9')}}
        <p>{{./url}} is older than {{./latest.url}}</p>
        {{/with}}
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-from-context}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include(
        '<p>/the-component/0.9/the-page.html is older than /the-component/1.0/the-page.html</p>'
      )
    })

    // NOTE undefined doesn't work since Handlebars never sets the property
    it('should be able to call built-in helper with null version to resolve latest version of page', () => {
      file = files['0.9']
      definePartial(
        'body-resolve-page-from-context',
        heredoc`
        {{#with (resolvePage 'the-page.adoc' version=null)}}
        <p>{{./url}} is {{./latest.url}}</p>
        {{/with}}
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-from-context}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include(
        '<p>/the-component/1.0/the-page.html is /the-component/1.0/the-page.html</p>'
      )
    })

    it('should be able to call built-in helper with context to resolve URL of page', () => {
      definePartial(
        'body-resolve-page-url-from-context',
        heredoc`
        <p>{{resolvePageURL page.relativeSrcPath version='0.9'}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-url-from-context}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>/the-component/0.9/the-page.html</p>')
    })

    // NOTE undefined doesn't work since Handlebars never sets the property
    it('should be able to call built-in helper with null version to resolve URL of latest version of page', () => {
      file = files['0.9']
      definePartial(
        'body-resolve-page-url-from-context',
        heredoc`
        <p>{{resolvePageURL page.relativeSrcPath version=null}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-resolve-page-url-from-context}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>/the-component/1.0/the-page.html</p>')
    })

    it('should be able to call built-in helper to relativize URL', () => {
      definePartial(
        'body-relativize-url',
        heredoc`
        <ul>
        {{#each page.component.versions}}
        <li>{{relativize ./url}}</li>
        {{/each}}
        <li>{{relativize '/'}}</li>
        <li>{{relativize '/index.html'}}</li>
        </ul>
        `
      )
      replaceCallToBodyPartial('{{> body-relativize-url}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include(heredoc`<ul>
      <li>index.html</li>
      <li>../0.9/index.html</li>
      <li>../../</li>
      <li>../../index.html</li>
      </ul>`)
    })

    it('should compute URL when to is indexified and to matches parent folder of from', () => {
      file.pub.url = '/the-component/1.0/topic/overview/'
      file.pub.rootPath = '../../../..'
      definePartial(
        'body-relativize-url',
        heredoc`
        <p>{{relativize '/the-component/1.0/topic/'}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-relativize-url}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>../</p>')
    })

    it('should compute URL when to is extensionless and to matches parent folder of from', () => {
      file.pub.url = '/the-component/1.0/topic/overview'
      file.pub.rootPath = '../../..'
      definePartial(
        'body-relativize-url',
        heredoc`
        <p>{{relativize '/the-component/1.0/topic'}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-relativize-url}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>../topic</p>')
    })

    it('should relativize URL by prepending site path if page.url is undefined', () => {
      definePartial(
        'body-relativize-url',
        heredoc`
        <p>{{relativize '/to.html'}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-relativize-url}}')
      playbook.site.url = 'https://docs.example.org/site'
      delete file.pub.url
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>/site/to.html</p>')
    })

    it('should not relativize URL if page.url and site.path are undefined', () => {
      definePartial(
        'body-relativize-url',
        heredoc`
        <p>{{relativize '/to.html'}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-relativize-url}}')
      delete file.pub.url
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>/to.html</p>')
    })

    it('should preserve fragment on URL passed to relativize', () => {
      definePartial(
        'body-relativize-url',
        heredoc`
        <p>{{relativize '/the-component/1.0/to.html#fragment'}}</p>
        `
      )
      replaceCallToBodyPartial('{{> body-relativize-url}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      composePage(file, contentCatalog, navigationCatalog)
      expect(file.contents.toString()).to.include('<p>to.html#fragment</p>')
    })

    it('should include template name of layout in error message', () => {
      defineLayout(
        'broken-layout',
        heredoc`
        {{#each site.components}}
        <p>{{./name}}</p>
        {{/each}}}
        `
      )
      playbook.ui.defaultLayout = 'broken-layout'
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      const expectedMessage = "Expecting 'CLOSE', got 'CLOSE_UNESCAPED'\n^ in UI template layouts/broken-layout.hbs"
      expect(() => composePage(file, contentCatalog, navigationCatalog)).to.throw(expectedMessage)
    })

    it('should include template name of partial in error message', () => {
      definePartial(
        'broken-partial',
        heredoc`
        {{#each site.components}}
        <p>{{./name}}</p>
        {{/if}}
        `
      )
      replaceCallToBodyPartial('{{> broken-partial}}')
      const composePage = createPageComposer(playbook, contentCatalog, uiCatalog)
      const expectedMessage = "each doesn't match if - 1:3 in UI template partials/broken-partial.hbs"
      expect(() => composePage(file, contentCatalog, navigationCatalog)).to.throw(expectedMessage)
    })

    describe('create404Page()', () => {
      it('should throw an error if 404 layout cannot be found', () => {
        const { create404Page } = createPageComposer(playbook, contentCatalog, uiCatalog)
        expect(() => create404Page()).to.throw(/404 layout not found/i)
      })

      it('should use 404 layout if component name is not set and stem is 404', () => {
        layouts.push({
          stem: '404',
          contents: Buffer.from(
            heredoc`
            <!DOCTYPE html>
            <html class="status-404">
            {{> head}}
            <link rel="stylesheet" href="{{uiRootPath}}/css/site.css">
            <h1>{{{page.title}}}</h1>
            </html>
            ` + '\n'
          ),
        })
        const { create404Page } = createPageComposer(playbook, contentCatalog, uiCatalog)
        const result = create404Page()
        expect(result.contents).to.be.instanceOf(Buffer)
        expect(result.contents.toString()).to.endWith('\n')
        expect(result.contents.toString().trimEnd()).to.equal(heredoc`
          <!DOCTYPE html>
          <html class="status-404">
          <title>Page Not Found</title>
          <link rel="stylesheet" href="/_/css/site.css">
          <h1>Page Not Found</h1>
          </html>
        `)
      })

      it('should set 404 property on UI page model for 404 page', () => {
        layouts.push({
          stem: '404',
          contents: Buffer.from(
            heredoc`
            <!DOCTYPE html>
            <html{{#if page.[404]}} class="status-404"{{/if}}>
            {{> head}}
            <link rel="stylesheet" href="{{uiRootPath}}/css/site.css">
            <h1>{{{page.title}}}</h1>
            </html>
            ` + '\n'
          ),
        })
        playbook.site.url = 'https://example.org/docs'
        const { create404Page } = createPageComposer(playbook, contentCatalog, uiCatalog)
        const result = create404Page()
        expect(result.contents).to.be.instanceOf(Buffer)
        expect(result.contents.toString()).to.endWith('\n')
        expect(result.contents.toString().trimEnd()).to.equal(heredoc`
          <!DOCTYPE html>
          <html class="status-404">
          <title>Page Not Found</title>
          <link rel="stylesheet" href="/docs/_/css/site.css">
          <h1>Page Not Found</h1>
          </html>
        `)
      })

      it('should allow 404 page to access site-wide page attributes', () => {
        layouts.push({
          stem: '404',
          contents: Buffer.from(
            heredoc`
            <!DOCTYPE html>
            <html class="status-404">
            {{> head}}
            <link rel="stylesheet" href="{{uiRootPath}}/css/site.css">
            <h1>{{{page.title}}}</h1>
            <p>Check out our <a href="{{page.attributes.product-url}}">products</a> instead.</p>
            </html>
            ` + '\n'
          ),
        })
        playbook.site.url = 'https://example.org/docs'
        const { create404Page } = createPageComposer(playbook, contentCatalog, uiCatalog)
        const result = create404Page({ attributes: { 'page-product-url': 'https://example.org/products' } })
        expect(result.contents).to.be.instanceOf(Buffer)
        expect(result.contents.toString()).to.endWith('\n')
        expect(result.contents.toString().trimEnd()).to.equal(heredoc`
          <!DOCTYPE html>
          <html class="status-404">
          <title>Page Not Found</title>
          <link rel="stylesheet" href="/docs/_/css/site.css">
          <h1>Page Not Found</h1>
          <p>Check out our <a href="https://example.org/products">products</a> instead.</p>
          </html>
        `)
      })

      it('should allow title of 404 page to be overridden using the 404-page-title attribute', () => {
        layouts.push({
          stem: '404',
          contents: Buffer.from(
            heredoc`
            <!DOCTYPE html>
            <html class="status-404">
            {{> head}}
            <link rel="stylesheet" href="{{uiRootPath}}/css/site.css">
            <h1>{{{page.title}}}</h1>
            </html>
            ` + '\n'
          ),
        })
        playbook.site.url = 'https://example.org/docs'
        const { create404Page } = createPageComposer(playbook, contentCatalog, uiCatalog)
        const result = create404Page({ attributes: { '404-page-title': 'Nothing to See Here' } })
        expect(result.contents).to.be.instanceOf(Buffer)
        expect(result.contents.toString()).to.endWith('\n')
        expect(result.contents.toString().trimEnd()).to.equal(heredoc`
          <!DOCTYPE html>
          <html class="status-404">
          <title>Nothing to See Here</title>
          <link rel="stylesheet" href="/docs/_/css/site.css">
          <h1>Nothing to See Here</h1>
          </html>
        `)
      })

      it('should prepend site path to UI root path if site URL contains a subpath', () => {
        layouts.push({
          stem: '404',
          contents: Buffer.from(
            heredoc`
            <!DOCTYPE html>
            <html class="status-404">
            {{> head}}
            <link rel="stylesheet" href="{{uiRootPath}}/css/site.css">
            <h1>{{{page.title}}}</h1>
            </html>
            ` + '\n'
          ),
        })
        playbook.site.url = 'https://example.org/docs'
        const { create404Page } = createPageComposer(playbook, contentCatalog, uiCatalog)
        const result = create404Page()
        expect(result.contents).to.be.instanceOf(Buffer)
        expect(result.contents.toString()).to.endWith('\n')
        expect(result.contents.toString().trimEnd()).to.equal(heredoc`
          <!DOCTYPE html>
          <html class="status-404">
          <title>Page Not Found</title>
          <link rel="stylesheet" href="/docs/_/css/site.css">
          <h1>Page Not Found</h1>
          </html>
        `)
      })
    })
  })
})

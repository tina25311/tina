/* eslint-env mocha */
'use strict'

const { expect, heredoc, mockContentCatalog, spy } = require('@antora/test-harness')

const convertDocuments = require('@antora/document-converter')
const { resolveAsciiDocConfig } = require('@antora/asciidoc-loader')

describe('convertDocuments()', () => {
  const asciidocConfig = resolveAsciiDocConfig()
  const expectPageLink = (html, url, content) =>
    expect(html).to.include(`<a href="${url}" class="xref page">${content}</a>`)

  it('should start with all files in the page family', () => {
    const contentCatalog = mockContentCatalog().spyOn('getPages')
    convertDocuments(contentCatalog)
    expect(contentCatalog.getPages).to.have.been.called()
  })

  it('should only process and return publishable files from the page family in the content catalog', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: '= Home\n\nThis is the index page.',
        mediaType: 'text/asciidoc',
      },
      {
        relative: '_attributes.adoc',
        contents: ':name: value',
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'topic/index.adoc',
        contents: '= Topic\n\nThis is a topic page.',
        mediaType: 'text/asciidoc',
      },
      {
        family: 'nav',
        relative: 'nav.adoc',
        contents: '* xref:index.adoc[Index]\n* xref:topic/index.adoc[Topic]',
        navIndex: 0,
      },
      {
        family: 'image',
        relative: 'logo.svg',
        contents: '<svg>...</svg>',
      },
    ])
    const attributesFile = contentCatalog.getFiles().find((f) => f.src.relative === '_attributes.adoc')
    const attributesFileContents = attributesFile.contents
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(pages).to.have.lengthOf(2)
    pages.forEach((page) => expect(page.src.mediaType).to.equal('text/asciidoc'))
    expect(attributesFile.contents).to.equal(attributesFileContents)
  })

  it('should convert contents of files in page family to embeddable HTML', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: '= Home\n\nThis is the index page.',
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'topic/index.adoc',
        contents: '= Topic\n\nThis is a topic page.',
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(pages).to.have.lengthOf(2)
    pages.forEach((page) => {
      expect(page.mediaType).to.equal('text/html')
      expect(page.contents.toString()).to.include('<p>')
    })
  })

  it('should remove src.contents property after all documents are converted', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: '= Home\n\nThis is the index page.',
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'topic/index.adoc',
        contents: '= Topic\n\nThis is a topic page.',
        mediaType: 'text/asciidoc',
      },
    ])
    contentCatalog.getComponents((component) => {
      component.versions.forEach((version) => (version.asciidoc = asciidocConfig))
    })
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(asciidocConfig).to.not.have.nested.property('attributes.page-partial')
    expect(pages).to.have.lengthOf(2)
    pages.forEach((page) => expect(page.src).to.not.have.property('contents'))
  })

  it('should not remove src.contents property if keepSource is set on site-wide asciidocConfig', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: '= Home\n\nThis is the index page.',
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'topic/index.adoc',
        contents: '= Topic\n\nThis is a topic page.',
        mediaType: 'text/asciidoc',
      },
    ])
    expect(asciidocConfig).to.not.have.nested.property('attributes.page-partial')
    const pages = convertDocuments(contentCatalog, Object.assign({}, asciidocConfig, { keepSource: true }))
    expect(pages).to.have.lengthOf(2)
    pages.forEach((page) => expect(page.src).to.have.property('contents'))
    expect(pages[0].src.contents.toString()).to.equal('= Home\n\nThis is the index page.')
    expect(pages[1].src.contents.toString()).to.equal('= Topic\n\nThis is a topic page.')
  })

  it('should assign relevant properties to asciidoc property on file object', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: '[reftext=Home]\n= Welcome\n\nThis is the index page.',
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'topic/index.adoc',
        contents: '= Topic\n:navtitle: About Topic\n\nThis is a topic page.',
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'untitled.adoc',
        contents: 'Untitled page.',
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(pages).to.have.lengthOf(3)
    pages.forEach((page) => {
      expect(page).to.have.nested.property('asciidoc.attributes')
    })
    const homePage = pages.find((it) => it.src.relative === 'index.adoc')
    expect(homePage).to.have.nested.property('asciidoc.doctitle', 'Welcome')
    expect(homePage).to.have.nested.property('asciidoc.xreftext', 'Home')
    expect(homePage).to.have.nested.property('asciidoc.navtitle', 'Home')
    const topicPage = pages.find((it) => it.src.relative === 'topic/index.adoc')
    expect(topicPage).to.have.nested.property('asciidoc.doctitle', 'Topic')
    expect(topicPage).to.have.nested.property('asciidoc.xreftext', 'Topic')
    expect(topicPage).to.have.nested.property('asciidoc.navtitle', 'About Topic')
    const untitledPage = pages.find((it) => it.src.relative === 'untitled.adoc')
    expect(untitledPage).to.not.have.nested.property('asciidoc.doctitle')
    expect(untitledPage).to.not.have.nested.property('asciidoc.xreftext')
    expect(untitledPage).to.not.have.nested.property('asciidoc.navtitle')
  })

  it('should assign value of doctitle to title property on file', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: '= Welcome\n\nThis is the index page.',
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(pages).to.have.lengthOf(1)
    const homePage = pages.find((it) => it.src.relative === 'index.adoc')
    expect(homePage.title).to.equal('Welcome')
  })

  it('should convert contents to embeddable HTML using default settings if AsciiDoc config not provided', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: heredoc`
        = Topic

        == Heading

        contents`,
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog)
    expect(pages).to.have.lengthOf(1)
    pages.forEach((page) => {
      expect(page.mediaType).to.equal('text/html')
      expect(page.contents.toString()).to.not.include('<a class="anchor"')
    })
  })

  it('should use AsciiDoc config scoped to component version, if available', () => {
    const contentCatalog = mockContentCatalog([
      {
        version: '1.0',
        relative: 'index.adoc',
        contents: 'btn:[Save]',
        mediaType: 'text/asciidoc',
      },
    ])
    const componentVersion = contentCatalog.getComponentVersion('component-a', '1.0')
    componentVersion.asciidoc = resolveAsciiDocConfig({
      asciidoc: { attributes: { experimental: '' } },
    })
    expect(asciidocConfig.attributes).to.not.have.property('experimental')
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(pages).to.have.lengthOf(1)
    pages.forEach((page) => {
      expect(page.mediaType).to.equal('text/html')
      expect(page.contents.toString()).to.include('<b class="button">Save</b>')
    })
  })

  it('should only convert documents that have the text/asciidoc media type', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: '= Hello, AsciiDoc!\n\nThis one should be converted.',
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'other.html',
        contents: '<p>This one should <em>not</em> be converted.</p>',
        mediaType: 'text/html',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(pages[0].contents.toString()).to.equal(heredoc`
    <div class="paragraph">
    <p>This one should be converted.</p>
    </div>
    `)
    expect(pages[1].contents.toString()).to.equal('<p>This one should <em>not</em> be converted.</p>')
  })

  it('should only convert documents that have the text/asciidoc media type even if the asciidoc property set', () => {
    const contentCatalog = mockContentCatalog([
      {
        relative: 'index.adoc',
        contents: '= Hello, AsciiDoc!\n\nThis one should be converted.',
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'other.html',
        contents: '<h1>Hello, HTML!</h1>\n<p>This one should <em>not</em> be converted.</p>',
        mediaType: 'text/html',
        asciidoc: {
          doctitle: 'Hello, HTML!',
        },
      },
    ])
    contentCatalog.getPages().find(({ src }) => src.relative === 'other.html').asciidoc = { doctitle: 'Hello, HTML!' }
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(pages[0].contents.toString()).to.equal(heredoc`
    <div class="paragraph">
    <p>This one should be converted.</p>
    </div>
    `)
    expect(pages[1].contents.toString()).to.equal(heredoc`
    <h1>Hello, HTML!</h1>
    <p>This one should <em>not</em> be converted.</p>
    `)
  })

  it('should register aliases defined by page-aliases document attribute', () => {
    const contents = Buffer.from(heredoc`
      = Page Title
      :page-aliases: the-alias.adoc,topic/the-alias.adoc, 1.0.0@page-a.adoc ,another-alias.adoc

      Page content.
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'page-a.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    const inputFile = contentCatalog.getFiles()[0]
    contentCatalog.registerPageAlias = spy(() => {})
    convertDocuments(contentCatalog, asciidocConfig)
    expect(contentCatalog.registerPageAlias).to.have.been.called.exactly(4)
    expect(contentCatalog.registerPageAlias).first.be.called.with('the-alias.adoc', inputFile)
    expect(contentCatalog.registerPageAlias).second.be.called.with('topic/the-alias.adoc', inputFile)
    expect(contentCatalog.registerPageAlias).third.be.called.with('1.0.0@page-a.adoc', inputFile)
    expect(contentCatalog.registerPageAlias).nth(4).be.called.with('another-alias.adoc', inputFile)
  })

  it('should register aliases split across lines using a line continuation', () => {
    const contents = Buffer.from(heredoc`
      = Page Title
      :page-aliases: the-alias.adoc, \
                     topic/the-alias, \
      1.0.0@page-a.adoc , \
      another-alias.adoc

      Page content.
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'page-a.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    contentCatalog.registerPageAlias = spy(() => {})
    const inputFile = contentCatalog.getFiles()[0]
    convertDocuments(contentCatalog, asciidocConfig)
    expect(contentCatalog.registerPageAlias).to.have.been.called.exactly(4)
    expect(contentCatalog.registerPageAlias).first.called.with('the-alias.adoc', inputFile)
    expect(contentCatalog.registerPageAlias).second.called.with('topic/the-alias', inputFile)
    expect(contentCatalog.registerPageAlias).third.called.with('1.0.0@page-a.adoc', inputFile)
    expect(contentCatalog.registerPageAlias).nth(4).called.with('another-alias.adoc', inputFile)
  })

  it('should register alias specified with no file extension', () => {
    const contents = Buffer.from(heredoc`
      = Page Title
      :page-aliases: the-alias,topic/the-alias

      Page content.
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'page-a.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    const inputFile = contentCatalog.getFiles()[0]
    contentCatalog.registerPageAlias = spy(() => {})
    convertDocuments(contentCatalog, asciidocConfig)
    expect(contentCatalog.registerPageAlias).to.have.been.called.exactly(2)
    expect(contentCatalog.registerPageAlias).first.be.called.with('the-alias', inputFile)
    expect(contentCatalog.registerPageAlias).second.be.called.with('topic/the-alias', inputFile)
  })

  it('should not register aliases if page-aliases document attribute is empty', () => {
    const contents = Buffer.from(heredoc`
      = Page Title
      :page-aliases:

      Page content.
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'page-a.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    contentCatalog.registerPageAlias = spy(() => {})
    convertDocuments(contentCatalog, asciidocConfig)
    expect(contentCatalog.registerPageAlias).to.not.have.been.called()
  })

  it('should fill in missing contents of page reference with automatic reference text', () => {
    const fromContents = Buffer.from(heredoc`
      = From

      Go to xref:to.adoc[].
    `)
    const toContents = Buffer.from(heredoc`
      = To

      You have arrived.
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'from.adoc',
        contents: fromContents,
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'to.adoc',
        contents: toContents,
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    const fromConvertedContents = pages.find((it) => it.src.relative === 'from.adoc').contents.toString()
    expectPageLink(fromConvertedContents, 'to.html', 'To')
  })

  it('should fill in missing contents of page reference that resolves to current page with page title', () => {
    const contents = Buffer.from(heredoc`
      = Document Title

      You are xref:here.adoc[].
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'here.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    const convertedContents = pages.find((it) => it.src.relative === 'here.adoc').contents.toString()
    expectPageLink(convertedContents, 'here.html', 'Document Title')
  })

  it('should fill in missing contents of page reference that resolves to current page without page title', () => {
    const contents = Buffer.from(heredoc`
      You are xref:here.adoc[].
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'here.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    const convertedContents = pages.find((it) => it.src.relative === 'here.adoc').contents.toString()
    expectPageLink(convertedContents, 'here.html', 'here.adoc')
  })

  // this case is handled by Asciidoctor itself
  it('should fill in missing contents of xref that points to top of page with page title', () => {
    const contents = Buffer.from(heredoc`
      = Document Title

      You are xref:#[].
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'here.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    const convertedContents = pages.find((it) => it.src.relative === 'here.adoc').contents.toString()
    expect(convertedContents).to.include('<a href="#">Document Title</a>')
  })

  // this case is handled by Asciidoctor itself
  it('should fill in missing contents of xref that points to top of page with no page title', () => {
    const contents = Buffer.from(heredoc`
      You are xref:#[].
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'here.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    const convertedContents = pages.find((it) => it.src.relative === 'here.adoc').contents.toString()
    expect(convertedContents).to.include('<a href="#">[^top]</a>')
  })

  it('should fill in missing contents of page reference with family that resolves to current page', () => {
    const contents = Buffer.from(heredoc`
      = Document Title

      You are xref:page$here.adoc[].
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'here.adoc',
        contents,
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    const convertedContents = pages.find((it) => it.src.relative === 'here.adoc').contents.toString()
    expectPageLink(convertedContents, 'here.html', 'Document Title')
  })

  // NOTE currently a negative test
  it('should not process resource ID in xref inside page title when resolving xreftext', () => {
    const contentsA = Buffer.from('= Page A xref:page$b.adoc[]\n\nContents of page A.')
    const contentsB = Buffer.from('= Page B xref:page$a.adoc[]\n\nContents of page B.')
    const contentCatalog = mockContentCatalog([
      { relative: 'page-a.adoc', contents: contentsA, mediaType: 'text/asciidoc' },
      { relative: 'page-b.adoc', contents: contentsB, mediaType: 'text/asciidoc' },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    const xreftextA = pages.find((it) => it.src.relative === 'page-a.adoc').asciidoc.xreftext
    const xreftextB = pages.find((it) => it.src.relative === 'page-b.adoc').asciidoc.xreftext
    expect(xreftextA).to.equal('Page A <a href="page$b.html">page$b.html</a>')
    expect(xreftextB).to.equal('Page B <a href="page$a.html">page$a.html</a>')
  })

  it('should be able to reference page alias as target of xref', () => {
    const contentsA = Buffer.from(heredoc`
      = The Page
      :page-aliases: a-page.adoc

      Go to xref:end-page.adoc[the end page].
    `)
    const contentsB = Buffer.from(heredoc`
      = Za Page
      :page-aliases: end-page.adoc

      Read from xref:a-page.adoc[the start page] to xref:end-page.adoc[the end page].
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'the-page.adoc',
        contents: contentsA,
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'za-page.adoc',
        contents: contentsB,
        mediaType: 'text/asciidoc',
      },
    ])
    const aliases = {}
    contentCatalog.registerPageAlias = (spec, targetPage) => {
      aliases[spec] = { rel: targetPage }
    }
    contentCatalog.resolveResource = (spec, ctx = {}) => {
      return (aliases[spec] || {}).rel
    }
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    const thePageContents = pages.find((it) => it.src.relative === 'the-page.adoc').contents.toString()
    const zaPageContents = pages.find((it) => it.src.relative === 'za-page.adoc').contents.toString()
    expectPageLink(thePageContents, 'za-page.html', 'the end page')
    expectPageLink(zaPageContents, 'the-page.html', 'the start page')
    expectPageLink(zaPageContents, 'za-page.html', 'the end page')
  })

  it('should be able to include a page which has already been converted', () => {
    const contentsA = Buffer.from(heredoc`
      = Changelog

      // tag::entries[]
      == Version 1.1

      * Bug fixes.
      // end::entries[]
    `)
    const contentsB = Buffer.from(heredoc`
      = Page Title

      == Recent Changes

      include::changelog.adoc[tag=entries,leveloffset=+1]
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'changelog.adoc',
        contents: contentsA,
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'z-page.adoc',
        contents: contentsB,
        mediaType: 'text/asciidoc',
      },
    ])
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    pages.forEach((page) => expect(page).to.have.nested.property('asciidoc.attributes.page-partial', ''))
    expect(pages[1].contents.toString()).to.include(heredoc`
      <div class="sect1">
      <h2 id="_recent_changes"><a class="anchor" href="#_recent_changes"></a>Recent Changes</h2>
      <div class="sectionbody">
      <div class="sect2">
      <h3 id="_version_1_1"><a class="anchor" href="#_version_1_1"></a>Version 1.1</h3>
      <div class="ulist">
      <ul>
      <li>
      <p>Bug fixes.</p>
      </li>
      </ul>
      </div>
      </div>
      </div>
      </div>
    `)
  })

  it('should not be able to include a page which has already been converted if page-partial is not set', () => {
    const contentsA = Buffer.from(heredoc`
      = Changelog

      // tag::entries[]
      == Version 1.1

      * Bug fixes.
      // end::entries[]
    `)
    const contentsB = Buffer.from(heredoc`
      = Page Title

      == Recent Changes

      include::changelog.adoc[tag=entries,leveloffset=+1]
    `)
    const contentCatalog = mockContentCatalog([
      {
        relative: 'changelog.adoc',
        contents: contentsA,
        mediaType: 'text/asciidoc',
      },
      {
        relative: 'z-page.adoc',
        contents: contentsB,
        mediaType: 'text/asciidoc',
      },
    ])
    const thisAsciiDocConfig = Object.assign({}, asciidocConfig, {
      attributes: Object.assign({}, asciidocConfig.attributes, { 'page-partial': null }),
    })
    contentCatalog.getComponents().forEach((component) => {
      component.versions.forEach((version) => (version.asciidoc = thisAsciiDocConfig))
    })
    const pages = convertDocuments(contentCatalog, thisAsciiDocConfig)
    pages.forEach((page) => expect(page).to.not.have.nested.property('asciidoc.attributes.page-partial'))
    expect(pages[1].contents.toString()).to.include(heredoc`
      <div class="sect1">
      <h2 id="_recent_changes"><a class="anchor" href="#_recent_changes"></a>Recent Changes</h2>
      <div class="sectionbody">

      </div>
      </div>
    `)
  })
})

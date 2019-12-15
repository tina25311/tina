/* eslint-env mocha */
'use strict'

const { expect, heredoc } = require('../../../test/test-utils')

const convertDocuments = require('@antora/document-converter')
const { resolveConfig: resolveAsciiDocConfig } = require('@antora/asciidoc-loader')
const mockContentCatalog = require('../../../test/mock-content-catalog')

describe('convertDocuments()', () => {
  const asciidocConfig = resolveAsciiDocConfig()

  it('should run on all files in the page family', () => {
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
    const attributesFile = contentCatalog.getAll().find((f) => f.src.relative === '_attributes.adoc')
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
    expect(asciidocConfig).not.to.have.nested.property('attributes.page-partial')
    const pages = convertDocuments(contentCatalog, asciidocConfig)
    expect(pages).to.have.lengthOf(2)
    pages.forEach((page) => {
      expect(page.src).not.to.have.property('contents')
    })
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
        relative: 'index.adoc',
        contents: 'btn:[Save]',
        mediaType: 'text/asciidoc',
      },
    ])
    const componentVersion = contentCatalog.getComponentVersion('component-a', 'master')
    componentVersion.asciidocConfig = resolveAsciiDocConfig({
      asciidoc: { attributes: { experimental: '' } },
    })
    expect(asciidocConfig.attributes).not.to.have.property('experimental')
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
})

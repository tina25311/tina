/* eslint-env mocha */
'use strict'

const { expect, expectCalledWith, heredoc, spy } = require('../../../test/test-utils')

const { convertDocument } = require('@antora/document-converter')
const { resolveConfig: resolveAsciiDocConfig } = require('@antora/asciidoc-loader')

describe('convertDocument()', () => {
  let inputFile
  let inputFileInTopicFolder
  let playbook
  let asciidocConfig

  const expectPageLink = (html, url, content) => expect(html).to.include(`<a href="${url}" class="page">${content}</a>`)

  beforeEach(() => {
    playbook = {
      site: {
        title: 'Docs',
        url: 'https://docs.example.org',
      },
    }
    asciidocConfig = resolveAsciiDocConfig(playbook)
    inputFile = {
      path: 'modules/module-a/pages/page-a.adoc',
      dirname: 'modules/module-a/pages',
      mediaType: 'text/asciidoc',
      src: {
        path: 'modules/module-a/pages/page-a.adoc',
        component: 'component-a',
        version: '1.2.3',
        module: 'module-a',
        family: 'page',
        relative: 'page-a.adoc',
        basename: 'page-a.adoc',
        stem: 'page-a',
        extname: '.adoc',
        mediaType: 'text/asciidoc',
        moduleRootPath: '..',
      },
      pub: {
        url: '/component-a/1.2.3/module-a/page-a.html',
        moduleRootPath: '.',
        rootPath: '../../..',
      },
    }
    inputFileInTopicFolder = {
      path: 'modules/module-a/pages/topic/page-b.adoc',
      dirname: 'modules/module-a/pages/topic',
      mediaType: 'text/asciidoc',
      src: {
        path: 'modules/module-a/pages/topic/page-b.adoc',
        component: 'component-a',
        version: '1.2.3',
        module: 'module-a',
        family: 'page',
        relative: 'topic/page-b.adoc',
        basename: 'page-b.adoc',
        stem: 'page-b',
        extname: '.adoc',
        mediaType: 'text/asciidoc',
        moduleRootPath: '../..',
      },
      pub: {
        url: '/component-a/1.2.3/module-a/topic/page-b.html',
        moduleRootPath: '..',
        rootPath: '../../../..',
      },
    }
  })

  it('should convert AsciiDoc contents on file to embeddable HTML', () => {
    inputFile.contents = Buffer.from(heredoc`
      = Page Title

      == Section Title

      Grab the link:{attachmentsdir}/quickstart-project.zip[quickstart project].

      * list item 1
      * list item 2
      * list item 3

      image::screenshot.png[]
    `)
    const module = 'module-a'
    const component = 'component-a'
    const imageFile = {
      path: `modules/${module}/assets/images/screenshot.png`,
      dirname: `modules/${module}/assets/images`,
      src: {
        path: `modules/${module}/assets/images/screenshot.png`,
        dirname: `modules/${module}/assets/images`,
        component: `${component}`,
        version: '1.2.3',
        module: `${module}`,
        family: 'image',
        relative: 'screenshot.png',
      },
      pub: {
        url: `/${component}/1.2.3/${module}/_images/screenshot.png`,
      },
    }
    const contentCatalog = { resolveResource: spy(() => imageFile), getComponent: () => { } }
    convertDocument(inputFile, contentCatalog, asciidocConfig)
    expect(inputFile.mediaType).to.equal('text/html')
    expect(inputFile.contents.toString()).to.equal(heredoc`
      <div class="sect1">
      <h2 id="_section_title"><a class="anchor" href="#_section_title"></a>Section Title</h2>
      <div class="sectionbody">
      <div class="paragraph">
      <p>Grab the <a href="_attachments/quickstart-project.zip">quickstart project</a>.</p>
      </div>
      <div class="ulist">
      <ul>
      <li>
      <p>list item 1</p>
      </li>
      <li>
      <p>list item 2</p>
      </li>
      <li>
      <p>list item 3</p>
      </li>
      </ul>
      </div>
      <div class="imageblock">
      <div class="content">
      <img src="_images/screenshot.png" alt="screenshot">
      </div>
      </div>
      </div>
      </div>
    `)
  })

  it('should resolve attachment relative to module root', () => {
    inputFileInTopicFolder.contents = Buffer.from(heredoc`
      Grab the link:{attachmentsdir}/quickstart-project.zip[quickstart project].
    `)
    convertDocument(inputFileInTopicFolder, undefined, asciidocConfig)
    const contents = inputFileInTopicFolder.contents.toString()
    expect(contents).to.include('href="../_attachments/quickstart-project.zip"')
  })

  it('should convert file using default settings if AsciiDoc config is not specified', () => {
    inputFile.contents = Buffer.from(heredoc`
      == Heading

      NOTE: Icons not enabled.
    `)
    convertDocument(inputFile)
    expect(inputFile.asciidoc).to.exist()
    const contents = inputFile.contents.toString()
    expect(contents).to.include('<h2 id="_heading">Heading</h2>')
    expect(contents).to.not.include('<i class="fa')
  })

  it('should set formatted document title to asciidoc.doctitle property on file object', () => {
    inputFile.contents = Buffer.from(heredoc`
      = _Awesome_ Document Title

      article contents
    `)
    convertDocument(inputFile, undefined, asciidocConfig)
    expect(inputFile.asciidoc).to.exist()
    expect(inputFile.asciidoc.doctitle).to.equal('<em>Awesome</em> Document Title')
  })

  it('should not set asciidoc.doctitle property on file object if document has no header', () => {
    inputFile.contents = Buffer.from(heredoc`
      article contents only
    `)
    convertDocument(inputFile, undefined, asciidocConfig)
    expect(inputFile.asciidoc).to.exist()
    expect(inputFile.asciidoc.doctitle).to.not.exist()
  })

  it('should save document header attributes to asciidoc.attributes property on file object', () => {
    inputFile.contents = Buffer.from(heredoc`
      = Document Title
      :keywords: CSS, flexbox, layout, box model

      article contents
    `)
    convertDocument(inputFile, undefined, asciidocConfig)
    expect(inputFile.asciidoc).to.exist()
    const attrs = inputFile.asciidoc.attributes
    expect(attrs).to.exist()
    expect(attrs).to.include({
      docfile: inputFile.path,
      env: 'site',
      imagesdir: '_images',
      keywords: 'CSS, flexbox, layout, box model',
    })
  })

  it('should pass custom attributes to processor', () => {
    inputFile.contents = Buffer.from(heredoc`
      = Document Title

      Get there in a flash with {product-name}.
    `)
    const customAttributes = {
      'product-name': 'Hi-Speed Tonic',
      'source-highlighter': 'html-pipeline',
    }
    Object.assign(asciidocConfig.attributes, customAttributes)
    convertDocument(inputFile, undefined, asciidocConfig)
    expect(inputFile.contents.toString()).to.include(customAttributes['product-name'])
    expect(inputFile.asciidoc).to.exist()
    expect(inputFile.asciidoc.attributes).to.exist()
    expect(inputFile.asciidoc.attributes).to.include(customAttributes)
  })

  it('should register aliases defined by page-aliases document attribute', () => {
    inputFile.contents = Buffer.from(heredoc`
      = Page Title
      :page-aliases: the-alias.adoc,topic/the-alias, 1.0.0@page-a.adoc ,another-alias.adoc

      Page content.
    `)
    const contentCatalog = { registerPageAlias: spy(() => {}), getComponent: () => {} }
    convertDocument(inputFile, contentCatalog, asciidocConfig)
    expect(contentCatalog.registerPageAlias).to.have.been.called.exactly(4)
    expectCalledWith(contentCatalog.registerPageAlias, ['the-alias.adoc', inputFile], 0)
    expectCalledWith(contentCatalog.registerPageAlias, ['topic/the-alias', inputFile], 1)
    expectCalledWith(contentCatalog.registerPageAlias, ['1.0.0@page-a.adoc', inputFile], 2)
    expectCalledWith(contentCatalog.registerPageAlias, ['another-alias.adoc', inputFile], 3)
  })

  it('should not register aliases if page-aliases document attribute is empty', () => {
    inputFile.contents = Buffer.from(heredoc`
      = Page Title
      :page-aliases:

      Page content.
    `)
    const contentCatalog = { registerPageAlias: spy(() => {}), getComponent: () => {} }
    convertDocument(inputFile, contentCatalog, asciidocConfig)
    expect(contentCatalog.registerPageAlias).to.not.have.been.called()
  })

  it('should convert page reference to URL of page in content catalog', () => {
    inputFile.contents = Buffer.from('xref:module-b:page-b.adoc[Page B]')
    const targetFile = {
      pub: {
        url: '/component-a/1.2.3/module-b/page-b.html',
      },
    }
    const contentCatalog = { resolvePage: spy(() => targetFile), getComponent: () => {} }
    convertDocument(inputFile, contentCatalog, asciidocConfig)
    expectCalledWith(contentCatalog.resolvePage, ['module-b:page-b', inputFile.src])
    expectPageLink(inputFile.contents.toString(), '../module-b/page-b.html', 'Page B')
  })

  it('should resolve target of include directive to file in content catalog', () => {
    inputFile.contents = Buffer.from('include::{partialsdir}/definitions.adoc[]')
    const partialFile = {
      path: 'modules/module-a/pages/_partials/definitions.adoc',
      dirname: 'modules/module-a/pages/_partials',
      contents: Buffer.from("cloud: someone else's computer"),
      src: {
        path: 'modules/module-a/pages/_partials/definitions.adoc',
        dirname: 'modules/module-a/pages/_partials',
        component: 'component-a',
        version: '1.2.3',
        module: 'module-a',
        family: 'partial',
        relative: 'definitions.adoc',
      },
    }
    const contentCatalog = { getById: spy(() => partialFile), getComponent: () => {} }
    convertDocument(inputFile, contentCatalog, asciidocConfig)
    expectCalledWith(contentCatalog.getById, {
      component: 'component-a',
      version: '1.2.3',
      module: 'module-a',
      family: 'partial',
      relative: 'definitions.adoc',
    })
    expect(inputFile.contents.toString()).to.include('cloud: someone else&#8217;s computer')
  })

  it('should be able to include which has already been converted', () => {
    inputFile.contents = Buffer.from(heredoc`
      = Page Title

      == Recent Changes

      include::changelog.adoc[tag=entries,leveloffset=+1]
    `)
    const includedFile = {
      path: 'modules/module-a/pages/changelog.adoc',
      dirname: 'modules/module-a/pages',
      contents: Buffer.from(heredoc`
        = Changelog

        // tag::entries[]
        == Version 1.1

        * Bug fixes.
        // end::entries[]
      `),
      src: {
        path: 'modules/module-a/pages/changelog.adoc',
        dirname: 'modules/module-a/pages',
        component: 'component-a',
        version: '1.2.3',
        module: 'module-a',
        family: 'page',
        relative: 'changelog.adoc',
      },
      pub: {
        url: '/component-a/1.2.3/module-a/changelog.html',
        moduleRootPath: '..',
        rootPath: '../../..',
      },
    }
    const contentCatalog = { getByPath: spy(() => includedFile), getComponent: () => {} }
    convertDocument(includedFile, undefined, asciidocConfig)
    expect(includedFile.src).to.have.property('contents')
    convertDocument(inputFile, contentCatalog, asciidocConfig)
    expectCalledWith(contentCatalog.getByPath, {
      component: 'component-a',
      version: '1.2.3',
      path: 'modules/module-a/pages/changelog.adoc',
    })
    expect(inputFile.contents.toString()).to.include(heredoc`
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

  it('should be able to include a page marked as a partial which has already been converted', () => {
    playbook.asciidoc = { attributes: { 'page-partial': false } }
    asciidocConfig = resolveAsciiDocConfig(playbook)
    inputFile.contents = Buffer.from(heredoc`
      = Page Title

      == Recent Changes

      include::changelog.adoc[tag=entries,leveloffset=+1]
    `)
    const includedFile = {
      path: 'modules/module-a/pages/changelog.adoc',
      dirname: 'modules/module-a/pages',
      contents: Buffer.from(heredoc`
        = Changelog
        :page-partial:

        // tag::entries[]
        == Version 1.1

        * Bug fixes.
        // end::entries[]
      `),
      src: {
        path: 'modules/module-a/pages/changelog.adoc',
        dirname: 'modules/module-a/pages',
        component: 'component-a',
        version: '1.2.3',
        module: 'module-a',
        family: 'page',
        relative: 'changelog.adoc',
      },
      pub: {
        url: '/component-a/1.2.3/module-a/changelog.html',
        moduleRootPath: '..',
        rootPath: '../../..',
      },
    }
    const contentCatalog = { getByPath: spy(() => includedFile), getComponent: () => {} }
    convertDocument(includedFile, undefined, asciidocConfig)
    expect(includedFile.src).to.have.property('contents')
    convertDocument(inputFile, contentCatalog, asciidocConfig)
    expectCalledWith(contentCatalog.getByPath, {
      component: 'component-a',
      version: '1.2.3',
      path: 'modules/module-a/pages/changelog.adoc',
    })
    expect(inputFile.contents.toString()).to.include(heredoc`
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
  ;['block', 'inline'].forEach((macroType) => {
    const macroDelim = macroType === 'block' ? '::' : ':'

    it(`should preserve target of ${macroType} image if target is a data URI`, () => {
      const imageData = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
      inputFile.contents = Buffer.from(`image${macroDelim}data:image/gif;base64,${imageData}[dot]`)
      convertDocument(inputFile, undefined, asciidocConfig)
      const contents = inputFile.contents.toString()
      expect(contents).to.include(`<img src="data:image/gif;base64,${imageData}" alt="dot">`)
    })

    it(`should use ${macroType} image target if target matches resource ID spec and syntax is invalid`, () => {
      inputFile.contents = Buffer.from(`image${macroDelim}component-b::[]`)
      const contentCatalog = {
        resolveResource: spy(() => {
          throw new Error()
        }),
        getComponent: () => { },
      }
      convertDocument(inputFile, contentCatalog, asciidocConfig)
      const contents = inputFile.contents.toString()
      expect(contents).to.include('<img src="component-b::" alt="">')
    })

    ;['png', 'svg'].forEach((imageType) => {
      it(`should resolve target of ${macroType} ${imageType} image relative to imagesdir`, () => {
        inputFile.contents = Buffer.from(`image${macroDelim}image-filename.${imageType}[]`)
        const module = 'module-a'
        const component = 'component-a'
        const imageFile = {
          path: `modules/${module}/assets/images/image-filename.${imageType}`,
          dirname: `modules/${module}/assets/images`,
          src: {
            path: `modules/${module}/assets/images/image-filename.${imageType}`,
            dirname: `modules/${module}/assets/images`,
            component: `${component}`,
            version: '1.2.3',
            module: `${module}`,
            family: 'image',
            relative: `image-filename.${imageType}`,
          },
          pub: {
            url: `/${component}/1.2.3/${module}/_images/image-filename.${imageType}`,
          },
        }
        const contentCatalog = { resolveResource: spy(() => imageFile), getComponent: () => { } }
        convertDocument(inputFile, contentCatalog, asciidocConfig)
        const contents = inputFile.contents.toString()
        expect(contents).to.include(`<img src="_images/image-filename.${imageType}" alt="image filename">`)
      })

      // NOTE this scenario should be disallowed in a future major release
      it(`should honor parent reference in target of ${macroType} ${imageType} image`, () => {
        inputFile.contents = Buffer.from(`image${macroDelim}../../module-b/_images/image-filename.${imageType}[]`)
        const module = 'module-b'
        const component = 'component-a'
        const imageFile = {
          path: `modules/${module}/assets/images/image-filename.${imageType}`,
          dirname: `modules/${module}/assets/images`,
          src: {
            path: `modules/${module}/assets/images/image-filename.${imageType}`,
            dirname: `modules/${module}/assets/images`,
            component: `${component}`,
            version: '1.2.3',
            module: `${module}`,
            family: 'image',
            relative: `image-filename.${imageType}`,
          },
          pub: {
            url: `/${component}/1.2.3/${module}/_images/image-filename.${imageType}`,
          },
        }
        const contentCatalog = { resolveResource: spy(() => imageFile), getComponent: () => { } }
        convertDocument(inputFile, contentCatalog, asciidocConfig)
        const contents = inputFile.contents.toString()
        expect(contents).to.include(`<img src="../module-b/_images/image-filename.${imageType}" alt="image filename">`)
      })

      it(`should preserve target of ${macroType} ${imageType} image if target is a URL`, () => {
        inputFile.contents = Buffer.from(`image${macroDelim}https://example.org/image-filename.${imageType}[]`)
        convertDocument(inputFile, undefined, asciidocConfig)
        const contents = inputFile.contents.toString()
        expect(contents).to.include(`<img src="https://example.org/image-filename.${imageType}" alt="image filename">`)
      })

      it(`should resolve target of ${macroType} ${imageType} image from file in topic folder relative to imagesdir`, () => {
        inputFileInTopicFolder.contents = Buffer.from(`image${macroDelim}image-filename.${imageType}[]`)
        const module = 'module-a'
        const component = 'component-a'
        const imageFile = {
          path: `modules/${module}/assets/images/image-filename.${imageType}`,
          dirname: `modules/${module}/assets/images`,
          src: {
            path: `modules/${module}/assets/images/image-filename.${imageType}`,
            dirname: `modules/${module}/assets/images`,
            component: `${component}`,
            version: '1.2.3',
            module: `${module}`,
            family: 'image',
            relative: `image-filename.${imageType}`,
          },
          pub: {
            url: `/${component}/1.2.3/${module}/_images/image-filename.${imageType}`,
          },
        }
        const contentCatalog = { resolveResource: spy(() => imageFile), getComponent: () => { } }
        convertDocument(inputFileInTopicFolder, contentCatalog, asciidocConfig)
        const contents = inputFileInTopicFolder.contents.toString()
        expect(contents).to.include(`<img src="../_images/image-filename.${imageType}" alt="image filename">`)
      })

      it(`should resolve non-URL target of ${macroType} ${imageType} image as resource spec if target contains a colon`, () => {
        inputFile.contents = Buffer.from(`image${macroDelim}module-b:image-filename.${imageType}[]`)
        const imageFile = {
          path: `modules/module-b/assets/images/image-filename.${imageType}`,
          dirname: 'modules/module-b/assets/images',
          src: {
            path: `modules/module-b/assets/images/image-filename.${imageType}`,
            dirname: 'modules/module-b/assets/images',
            component: 'component-a',
            version: '1.2.3',
            module: 'module-b',
            family: 'image',
            relative: `image-filename.${imageType}`,
          },
          pub: {
            url: `/component-a/1.2.3/module-b/_images/image-filename.${imageType}`,
          },
        }
        const contentCatalog = { resolveResource: spy(() => imageFile), getComponent: () => { } }
        convertDocument(inputFile, contentCatalog, asciidocConfig)
        const contents = inputFile.contents.toString()
        expect(contents).to.include(`<img src="../module-b/_images/image-filename.${imageType}" alt="image filename">`)
      })

      it(`should resolve non-URL target of ${macroType} ${imageType} image as resource spec if target contains an at sign`, () => {
        inputFile.contents = Buffer.from(`image${macroDelim}2.0.0@image-filename.${imageType}[]`)
        const imageFile = {
          path: `modules/module-b/assets/images/image-filename.${imageType}`,
          dirname: 'modules/module-b/assets/images',
          src: {
            path: `modules/module-b/assets/images/image-filename.${imageType}`,
            dirname: 'modules/module-b/assets/images',
            component: 'component-a',
            version: '2.0.0',
            module: 'module-b',
            family: 'image',
            relative: `image-filename.${imageType}`,
          },
          pub: {
            url: `/component-a/2.0.0/module-b/_images/image-filename.${imageType}`,
          },
        }
        const contentCatalog = { resolveResource: spy(() => imageFile), getComponent: () => { } }
        convertDocument(inputFile, contentCatalog, asciidocConfig)
        const contents = inputFile.contents.toString()
        expect(contents).to.include(`<img src="../../2.0.0/module-b/_images/image-filename.${imageType}" alt="image filename">`)
      })

      it(`should use ${macroType} ${imageType} image target if target matches resource ID spec and image cannot be resolved`, () => {
        inputFile.contents = Buffer.from(`image${macroDelim}no-such-module:image-filename.${imageType}[]`)
        const contentCatalog = { resolveResource: spy(() => undefined), getComponent: () => { } }
        convertDocument(inputFile, contentCatalog, asciidocConfig)
        const contents = inputFile.contents.toString()
        expect(contents).to.include(`<img src="no-such-module:image-filename.${imageType}" alt="image filename">`)
      })
    })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" contentScriptType="application/ecmascript" contentStyleType="text/css" preserveAspectRatio="none" version="1.1" viewBox="0 0 277 226" zoomAndPan="magnify"><defs><filter height="300%" id="f1ty01oal6yhj7" width="300%" x="-1" y="-1"><feGaussianBlur result="blurOut" stdDeviation="2.0"/><feColorMatrix in="blurOut" result="blurOut2" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .4 0"/><feOffset dx="4.0" dy="4.0" in="blurOut2" result="blurOut3"/><feBlend in="SourceGraphic" in2="blurOut3" mode="normal"/></filter></defs><g><ellipse cx="132.5" cy="20" fill="#000000" filter="url(#f1ty01oal6yhj7)" rx="10" ry="10" style="stroke: none; stroke-width: 1.0;"/><polygon fill="#FEFECE" filter="url(#f1ty01oal6yhj7)" points="82,50,183,50,195,62,183,74,82,74,70,62,82,50" style="stroke: #A80036; stroke-width: 1.5;"/><text fill="#000000" font-family="sans-serif" font-size="11" lengthAdjust="spacingAndGlyphs" textLength="101" x="82" y="65.8081">Going to Devoxx?</text><text fill="#000000" font-family="sans-serif" font-size="11" lengthAdjust="spacingAndGlyphs" textLength="20" x="50" y="59.4058">yes</text><text fill="#000000" font-family="sans-serif" font-size="11" lengthAdjust="spacingAndGlyphs" textLength="14" x="195" y="59.4058">no</text><rect fill="#FEFECE" filter="url(#f1ty01oal6yhj7)" height="61.9063" rx="12.5" ry="12.5" style="stroke: #A80036; stroke-width: 1.5;" width="100" x="10" y="84"/><text fill="#000000" font-family="sans-serif" font-size="12" lengthAdjust="spacingAndGlyphs" textLength="72" x="24" y="105.1387">attend talks</text><text fill="#000000" font-family="sans-serif" font-size="12" lengthAdjust="spacingAndGlyphs" textLength="49" x="24" y="119.1074">network</text><text fill="#000000" font-family="sans-serif" font-size="12" lengthAdjust="spacingAndGlyphs" textLength="62" x="24" y="133.0762">drink beer</text><rect fill="#FEFECE" filter="url(#f1ty01oal6yhj7)" height="61.9063" rx="12.5" ry="12.5" style="stroke: #A80036; stroke-width: 1.5;" width="123" x="143.5" y="84"/><text fill="#000000" font-family="sans-serif" font-size="12" lengthAdjust="spacingAndGlyphs" textLength="69" x="157.5" y="105.1387">watch talks</text><text fill="#000000" font-family="sans-serif" font-size="12" lengthAdjust="spacingAndGlyphs" textLength="95" x="157.5" y="119.1074">live on YouTube</text><text fill="#000000" font-family="sans-serif" font-size="12" lengthAdjust="spacingAndGlyphs" textLength="94" x="157.5" y="133.0762">(without pants)</text><polygon fill="#FEFECE" filter="url(#f1ty01oal6yhj7)" points="132.5,151.9063,144.5,163.9063,132.5,175.9063,120.5,163.9063,132.5,151.9063" style="stroke: #A80036; stroke-width: 1.5;"/><ellipse cx="132.5" cy="205.9063" fill="none" filter="url(#f1ty01oal6yhj7)" rx="10" ry="10" style="stroke: #000000; stroke-width: 1.0;"/><ellipse cx="133" cy="206.4063" fill="#000000" filter="url(#f1ty01oal6yhj7)" rx="6" ry="6" style="stroke: none; stroke-width: 1.0;"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="70" x2="60" y1="62" y2="62"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="60" x2="60" y1="62" y2="84"/><polygon fill="#A80036" points="56,74,60,84,64,74,60,78" style="stroke: #A80036; stroke-width: 1.0;"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="195" x2="205" y1="62" y2="62"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="205" x2="205" y1="62" y2="84"/><polygon fill="#A80036" points="201,74,205,84,209,74,205,78" style="stroke: #A80036; stroke-width: 1.0;"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="60" x2="60" y1="145.9063" y2="163.9063"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="60" x2="120.5" y1="163.9063" y2="163.9063"/><polygon fill="#A80036" points="110.5,159.9063,120.5,163.9063,110.5,167.9063,114.5,163.9063" style="stroke: #A80036; stroke-width: 1.0;"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="205" x2="205" y1="145.9063" y2="163.9063"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="205" x2="144.5" y1="163.9063" y2="163.9063"/><polygon fill="#A80036" points="154.5,159.9063,144.5,163.9063,154.5,167.9063,150.5,163.9063" style="stroke: #A80036; stroke-width: 1.0;"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="132.5" x2="132.5" y1="30" y2="50"/><polygon fill="#A80036" points="128.5,40,132.5,50,136.5,40,132.5,44" style="stroke: #A80036; stroke-width: 1.0;"/><line style="stroke: #A80036; stroke-width: 1.5;" x1="132.5" x2="132.5" y1="175.9063" y2="195.9063"/><polygon fill="#A80036" points="128.5,185.9063,132.5,195.9063,136.5,185.9063,132.5,189.9063" style="stroke: #A80036; stroke-width: 1.0;"/>
<!--
PlantUML version 1.2017.15(Mon Jul 03 10:45:34 MDT 2017)
(APACHE source distribution)
-->
</g></svg>`

    const dataUri = 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiBjb250ZW50U2NyaXB0VHlwZT0iYXBwbGljYXRpb24vZWNtYXNjcmlwdCIgY29udGVudFN0eWxlVHlwZT0idGV4dC9jc3MiIHByZXNlcnZlQXNwZWN0UmF0aW89Im5vbmUiIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDI3NyAyMjYiIHpvb21BbmRQYW49Im1hZ25pZnkiPjxkZWZzPjxmaWx0ZXIgaGVpZ2h0PSIzMDAlIiBpZD0iZjF0eTAxb2FsNnloajciIHdpZHRoPSIzMDAlIiB4PSItMSIgeT0iLTEiPjxmZUdhdXNzaWFuQmx1ciByZXN1bHQ9ImJsdXJPdXQiIHN0ZERldmlhdGlvbj0iMi4wIi8+PGZlQ29sb3JNYXRyaXggaW49ImJsdXJPdXQiIHJlc3VsdD0iYmx1ck91dDIiIHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAuNCAwIi8+PGZlT2Zmc2V0IGR4PSI0LjAiIGR5PSI0LjAiIGluPSJibHVyT3V0MiIgcmVzdWx0PSJibHVyT3V0MyIvPjxmZUJsZW5kIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImJsdXJPdXQzIiBtb2RlPSJub3JtYWwiLz48L2ZpbHRlcj48L2RlZnM+PGc+PGVsbGlwc2UgY3g9IjEzMi41IiBjeT0iMjAiIGZpbGw9IiMwMDAwMDAiIGZpbHRlcj0idXJsKCNmMXR5MDFvYWw2eWhqNykiIHJ4PSIxMCIgcnk9IjEwIiBzdHlsZT0ic3Ryb2tlOiBub25lOyBzdHJva2Utd2lkdGg6IDEuMDsiLz48cG9seWdvbiBmaWxsPSIjRkVGRUNFIiBmaWx0ZXI9InVybCgjZjF0eTAxb2FsNnloajcpIiBwb2ludHM9IjgyLDUwLDE4Myw1MCwxOTUsNjIsMTgzLDc0LDgyLDc0LDcwLDYyLDgyLDUwIiBzdHlsZT0ic3Ryb2tlOiAjQTgwMDM2OyBzdHJva2Utd2lkdGg6IDEuNTsiLz48dGV4dCBmaWxsPSIjMDAwMDAwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMSIgbGVuZ3RoQWRqdXN0PSJzcGFjaW5nQW5kR2x5cGhzIiB0ZXh0TGVuZ3RoPSIxMDEiIHg9IjgyIiB5PSI2NS44MDgxIj5Hb2luZyB0byBEZXZveHg/PC90ZXh0Pjx0ZXh0IGZpbGw9IiMwMDAwMDAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjExIiBsZW5ndGhBZGp1c3Q9InNwYWNpbmdBbmRHbHlwaHMiIHRleHRMZW5ndGg9IjIwIiB4PSI1MCIgeT0iNTkuNDA1OCI+eWVzPC90ZXh0Pjx0ZXh0IGZpbGw9IiMwMDAwMDAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjExIiBsZW5ndGhBZGp1c3Q9InNwYWNpbmdBbmRHbHlwaHMiIHRleHRMZW5ndGg9IjE0IiB4PSIxOTUiIHk9IjU5LjQwNTgiPm5vPC90ZXh0PjxyZWN0IGZpbGw9IiNGRUZFQ0UiIGZpbHRlcj0idXJsKCNmMXR5MDFvYWw2eWhqNykiIGhlaWdodD0iNjEuOTA2MyIgcng9IjEyLjUiIHJ5PSIxMi41IiBzdHlsZT0ic3Ryb2tlOiAjQTgwMDM2OyBzdHJva2Utd2lkdGg6IDEuNTsiIHdpZHRoPSIxMDAiIHg9IjEwIiB5PSI4NCIvPjx0ZXh0IGZpbGw9IiMwMDAwMDAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBsZW5ndGhBZGp1c3Q9InNwYWNpbmdBbmRHbHlwaHMiIHRleHRMZW5ndGg9IjcyIiB4PSIyNCIgeT0iMTA1LjEzODciPmF0dGVuZCB0YWxrczwvdGV4dD48dGV4dCBmaWxsPSIjMDAwMDAwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiIgbGVuZ3RoQWRqdXN0PSJzcGFjaW5nQW5kR2x5cGhzIiB0ZXh0TGVuZ3RoPSI0OSIgeD0iMjQiIHk9IjExOS4xMDc0Ij5uZXR3b3JrPC90ZXh0Pjx0ZXh0IGZpbGw9IiMwMDAwMDAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBsZW5ndGhBZGp1c3Q9InNwYWNpbmdBbmRHbHlwaHMiIHRleHRMZW5ndGg9IjYyIiB4PSIyNCIgeT0iMTMzLjA3NjIiPmRyaW5rIGJlZXI8L3RleHQ+PHJlY3QgZmlsbD0iI0ZFRkVDRSIgZmlsdGVyPSJ1cmwoI2YxdHkwMW9hbDZ5aGo3KSIgaGVpZ2h0PSI2MS45MDYzIiByeD0iMTIuNSIgcnk9IjEyLjUiIHN0eWxlPSJzdHJva2U6ICNBODAwMzY7IHN0cm9rZS13aWR0aDogMS41OyIgd2lkdGg9IjEyMyIgeD0iMTQzLjUiIHk9Ijg0Ii8+PHRleHQgZmlsbD0iIzAwMDAwMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIiIGxlbmd0aEFkanVzdD0ic3BhY2luZ0FuZEdseXBocyIgdGV4dExlbmd0aD0iNjkiIHg9IjE1Ny41IiB5PSIxMDUuMTM4NyI+d2F0Y2ggdGFsa3M8L3RleHQ+PHRleHQgZmlsbD0iIzAwMDAwMCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIiIGxlbmd0aEFkanVzdD0ic3BhY2luZ0FuZEdseXBocyIgdGV4dExlbmd0aD0iOTUiIHg9IjE1Ny41IiB5PSIxMTkuMTA3NCI+bGl2ZSBvbiBZb3VUdWJlPC90ZXh0Pjx0ZXh0IGZpbGw9IiMwMDAwMDAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBsZW5ndGhBZGp1c3Q9InNwYWNpbmdBbmRHbHlwaHMiIHRleHRMZW5ndGg9Ijk0IiB4PSIxNTcuNSIgeT0iMTMzLjA3NjIiPih3aXRob3V0IHBhbnRzKTwvdGV4dD48cG9seWdvbiBmaWxsPSIjRkVGRUNFIiBmaWx0ZXI9InVybCgjZjF0eTAxb2FsNnloajcpIiBwb2ludHM9IjEzMi41LDE1MS45MDYzLDE0NC41LDE2My45MDYzLDEzMi41LDE3NS45MDYzLDEyMC41LDE2My45MDYzLDEzMi41LDE1MS45MDYzIiBzdHlsZT0ic3Ryb2tlOiAjQTgwMDM2OyBzdHJva2Utd2lkdGg6IDEuNTsiLz48ZWxsaXBzZSBjeD0iMTMyLjUiIGN5PSIyMDUuOTA2MyIgZmlsbD0ibm9uZSIgZmlsdGVyPSJ1cmwoI2YxdHkwMW9hbDZ5aGo3KSIgcng9IjEwIiByeT0iMTAiIHN0eWxlPSJzdHJva2U6ICMwMDAwMDA7IHN0cm9rZS13aWR0aDogMS4wOyIvPjxlbGxpcHNlIGN4PSIxMzMiIGN5PSIyMDYuNDA2MyIgZmlsbD0iIzAwMDAwMCIgZmlsdGVyPSJ1cmwoI2YxdHkwMW9hbDZ5aGo3KSIgcng9IjYiIHJ5PSI2IiBzdHlsZT0ic3Ryb2tlOiBub25lOyBzdHJva2Utd2lkdGg6IDEuMDsiLz48bGluZSBzdHlsZT0ic3Ryb2tlOiAjQTgwMDM2OyBzdHJva2Utd2lkdGg6IDEuNTsiIHgxPSI3MCIgeDI9IjYwIiB5MT0iNjIiIHkyPSI2MiIvPjxsaW5lIHN0eWxlPSJzdHJva2U6ICNBODAwMzY7IHN0cm9rZS13aWR0aDogMS41OyIgeDE9IjYwIiB4Mj0iNjAiIHkxPSI2MiIgeTI9Ijg0Ii8+PHBvbHlnb24gZmlsbD0iI0E4MDAzNiIgcG9pbnRzPSI1Niw3NCw2MCw4NCw2NCw3NCw2MCw3OCIgc3R5bGU9InN0cm9rZTogI0E4MDAzNjsgc3Ryb2tlLXdpZHRoOiAxLjA7Ii8+PGxpbmUgc3R5bGU9InN0cm9rZTogI0E4MDAzNjsgc3Ryb2tlLXdpZHRoOiAxLjU7IiB4MT0iMTk1IiB4Mj0iMjA1IiB5MT0iNjIiIHkyPSI2MiIvPjxsaW5lIHN0eWxlPSJzdHJva2U6ICNBODAwMzY7IHN0cm9rZS13aWR0aDogMS41OyIgeDE9IjIwNSIgeDI9IjIwNSIgeTE9IjYyIiB5Mj0iODQiLz48cG9seWdvbiBmaWxsPSIjQTgwMDM2IiBwb2ludHM9IjIwMSw3NCwyMDUsODQsMjA5LDc0LDIwNSw3OCIgc3R5bGU9InN0cm9rZTogI0E4MDAzNjsgc3Ryb2tlLXdpZHRoOiAxLjA7Ii8+PGxpbmUgc3R5bGU9InN0cm9rZTogI0E4MDAzNjsgc3Ryb2tlLXdpZHRoOiAxLjU7IiB4MT0iNjAiIHgyPSI2MCIgeTE9IjE0NS45MDYzIiB5Mj0iMTYzLjkwNjMiLz48bGluZSBzdHlsZT0ic3Ryb2tlOiAjQTgwMDM2OyBzdHJva2Utd2lkdGg6IDEuNTsiIHgxPSI2MCIgeDI9IjEyMC41IiB5MT0iMTYzLjkwNjMiIHkyPSIxNjMuOTA2MyIvPjxwb2x5Z29uIGZpbGw9IiNBODAwMzYiIHBvaW50cz0iMTEwLjUsMTU5LjkwNjMsMTIwLjUsMTYzLjkwNjMsMTEwLjUsMTY3LjkwNjMsMTE0LjUsMTYzLjkwNjMiIHN0eWxlPSJzdHJva2U6ICNBODAwMzY7IHN0cm9rZS13aWR0aDogMS4wOyIvPjxsaW5lIHN0eWxlPSJzdHJva2U6ICNBODAwMzY7IHN0cm9rZS13aWR0aDogMS41OyIgeDE9IjIwNSIgeDI9IjIwNSIgeTE9IjE0NS45MDYzIiB5Mj0iMTYzLjkwNjMiLz48bGluZSBzdHlsZT0ic3Ryb2tlOiAjQTgwMDM2OyBzdHJva2Utd2lkdGg6IDEuNTsiIHgxPSIyMDUiIHgyPSIxNDQuNSIgeTE9IjE2My45MDYzIiB5Mj0iMTYzLjkwNjMiLz48cG9seWdvbiBmaWxsPSIjQTgwMDM2IiBwb2ludHM9IjE1NC41LDE1OS45MDYzLDE0NC41LDE2My45MDYzLDE1NC41LDE2Ny45MDYzLDE1MC41LDE2My45MDYzIiBzdHlsZT0ic3Ryb2tlOiAjQTgwMDM2OyBzdHJva2Utd2lkdGg6IDEuMDsiLz48bGluZSBzdHlsZT0ic3Ryb2tlOiAjQTgwMDM2OyBzdHJva2Utd2lkdGg6IDEuNTsiIHgxPSIxMzIuNSIgeDI9IjEzMi41IiB5MT0iMzAiIHkyPSI1MCIvPjxwb2x5Z29uIGZpbGw9IiNBODAwMzYiIHBvaW50cz0iMTI4LjUsNDAsMTMyLjUsNTAsMTM2LjUsNDAsMTMyLjUsNDQiIHN0eWxlPSJzdHJva2U6ICNBODAwMzY7IHN0cm9rZS13aWR0aDogMS4wOyIvPjxsaW5lIHN0eWxlPSJzdHJva2U6ICNBODAwMzY7IHN0cm9rZS13aWR0aDogMS41OyIgeDE9IjEzMi41IiB4Mj0iMTMyLjUiIHkxPSIxNzUuOTA2MyIgeTI9IjE5NS45MDYzIi8+PHBvbHlnb24gZmlsbD0iI0E4MDAzNiIgcG9pbnRzPSIxMjguNSwxODUuOTA2MywxMzIuNSwxOTUuOTA2MywxMzYuNSwxODUuOTA2MywxMzIuNSwxODkuOTA2MyIgc3R5bGU9InN0cm9rZTogI0E4MDAzNjsgc3Ryb2tlLXdpZHRoOiAxLjA7Ii8+CjwhLS0KUGxhbnRVTUwgdmVyc2lvbiAxLjIwMTcuMTUoTW9uIEp1bCAwMyAxMDo0NTozNCBNRFQgMjAxNykKKEFQQUNIRSBzb3VyY2UgZGlzdHJpYnV0aW9uKQotLT4KPC9nPjwvc3ZnPgo='

    ;['inline', 'interactive', 'data-uri'].forEach((style) => {
      const options = style === 'data-uri' ? '' : `opts=${style}`

      ;['module-a', 'module-b'].forEach((module) => {
        const modulePrefix = module === 'module-a' ? '' : 'module-b:'
        const componentVersion = module === 'module-a' ? '1.2.3' : '2.0.0'
        const imagePath = module === 'module-a' ? '_images/activity-diagram.svg' : '../../2.0.0/module-b/_images/activity-diagram.svg'
        const result = style === 'inline' ? svg
          : style === 'interactive' ? `<object type="image/svg+xml" data="${imagePath}">` : `<img src="${dataUri}" alt="activity diagram">`

        it(`should produce ${style} svg image using ${macroType} macro with image from ${module}`, () => {
          if (style === 'data-uri') asciidocConfig.attributes[style] = true
          inputFile.contents = Buffer.from(`image${macroDelim}${modulePrefix}activity-diagram.svg[${options}]`)
          const imageFile = {
            path: `modules/${module}/assets/images/activity-diagram.svg`,
            dirname: `modules/${module}/assets/images`,
            src: {
              path: `modules/${module}/assets/images/activity-diagram.svg`,
              dirname: `modules/${module}/assets/images`,
              component: 'component-a',
              version: `${componentVersion}`,
              module: `${module}`,
              family: 'image',
              extname: '.svg',
              relative: 'activity-diagram.svg',
            },
            pub: {
              url: `/component-a/${componentVersion}/${module}/_images/activity-diagram.svg`,
            },
            contents: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>${svg}\n`,
          }
          const contentCatalog = { resolveResource: spy(() => imageFile), getComponent: () => { } }
          convertDocument(inputFile, contentCatalog, asciidocConfig)
          const contents = inputFile.contents.toString()
          expect(contents).to.include(result)
        })
      })

      const imagePath = 'https://gitlab.com/antora/antora/raw/master/packages/site-generator-default/test/fixtures/the-component/modules/ROOT/assets/images/activity-diagram.svg?inline=false'
      const result = style === 'inline' ? svg
        : style === 'interactive' ? `<object type="image/svg+xml" data="${imagePath}">` : `<img src="${dataUri}" alt="activity diagram">`

      it(`should produce ${style} svg image using ${macroType} macro with remote image`, () => {
        asciidocConfig.attributes['allow-uri-read'] = true
        if (style === 'data-uri') asciidocConfig.attributes[style] = true
        inputFile.contents = Buffer.from(`image${macroDelim}https://gitlab.com/antora/antora/raw/master/packages/site-generator-default/test/fixtures/the-component/modules/ROOT/assets/images/activity-diagram.svg?inline=false[${options}]`)
        const contentCatalog = { resolveResource: spy(() => undefined), getComponent: () => { } }
        convertDocument(inputFile, contentCatalog, asciidocConfig)
        const contents = inputFile.contents.toString()
        expect(contents).to.include(result)
      })
    })
  })
})

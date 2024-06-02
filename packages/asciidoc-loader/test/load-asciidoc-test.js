/* eslint-env mocha */
'use strict'

const {
  captureLogSync,
  captureStderrSync,
  captureStdoutLogSync,
  configureLogger,
  expect,
  heredoc,
  mockContentCatalog,
} = require('@antora/test-harness')

// NOTE use separate require statement to verify loadAsciiDoc is default export
const loadAsciiDoc = require('@antora/asciidoc-loader')
const { resolveAsciiDocConfig } = loadAsciiDoc
const ospath = require('path')

const Opal = global.Opal
const Asciidoctor = Opal.Asciidoctor

const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')

describe('loadAsciiDoc()', () => {
  let inputFile

  const expectLink = (html, url, content, classes) =>
    expect(html).to.include(`<a href="${url}"${classes ? ' class="' + classes + '"' : ''}>${content}</a>`)
  const expectUnresolvedPageLink = (html, url, content) =>
    expect(html).to.include(`<a href="${url}" class="xref unresolved">${content}</a>`)
  const expectPageLink = (html, url, content) =>
    expect(html).to.include(`<a href="${url}" class="xref page">${content}</a>`)
  const expectImgLink = (html, url, content) => expect(html).to.include(`<a class="image" href="${url}">${content}</a>`)

  const setInputFileContents = (contents) => {
    inputFile.contents = Buffer.from(contents)
  }

  beforeEach(() => {
    inputFile = {
      path: 'modules/module-a/pages/page-a.adoc',
      dirname: 'modules/module-a/pages',
      src: {
        path: 'modules/module-a/pages/page-a.adoc',
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'page-a.adoc',
        basename: 'page-a.adoc',
        stem: 'page-a',
        extname: '.adoc',
      },
      pub: {
        url: '/component-a/module-a/page-a.html',
        moduleRootPath: '.',
        rootPath: '../..',
      },
    }
  })

  afterEach(() => Asciidoctor.LoggerManager.setLogger(null))

  it('should export loadAsciiDoc as default function', () => {
    expect(loadAsciiDoc.loadAsciiDoc).to.equal(loadAsciiDoc)
  })

  it('should export deprecated resolveConfig function as alias of resolveAsciiDocConfig', () => {
    expect(loadAsciiDoc.resolveConfig).to.equal(loadAsciiDoc.resolveAsciiDocConfig)
  })

  it('should load document model without sourcemap from AsciiDoc contents', () => {
    const contents = heredoc`
      = Document Title

      == Section Title

      paragraph

      * list item 1
      * list item 2
      * list item 3
    `
    setInputFileContents(contents)
    const doc = loadAsciiDoc(inputFile)
    expect(doc.getOptions().sourcemap).to.be.undefined()
    const allBlocks = doc.findBy()
    expect(allBlocks).to.have.lengthOf(8)
    allBlocks.forEach((block) => {
      expect(block.getSourceLocation()).to.be.undefined()
    })
  })

  it('should enable sourcemap on document if sourcemap option is set in config', () => {
    const contents = heredoc`
      = Document Title

      == Section Title

      paragraph

      * list item 1
      * list item 2
      * list item 3
    `
    setInputFileContents(contents)
    const doc = loadAsciiDoc(inputFile, undefined, { sourcemap: true })
    expect(doc.getOptions().sourcemap).to.be.true()
    const ul = doc.findBy({ context: 'ulist' })[0]
    expect(ul.getSourceLocation()).to.exist()
    expect(ul.getSourceLocation().getLineNumber()).to.equal(7)
    const li = ul.getItems()[1]
    expect(li.getSourceLocation()).to.exist()
    expect(li.getSourceLocation().getLineNumber()).to.equal(8)
  })

  it('should load document model with only header from AsciiDoc contents if headerOnly option is set', () => {
    const contents = heredoc`
      = Document Title
      :page-layout: home

      == Section Title

      paragraph

      * list item 1
      * list item 2
      * list item 3
    `
    setInputFileContents(contents)
    const doc = loadAsciiDoc(inputFile, undefined, { headerOnly: true })
    expect(doc.getBlocks()).to.be.empty()
    expect(doc.getDocumentTitle()).to.eql('Document Title')
    expect(doc.getAttribute('page-layout')).to.eql('home')
  })

  it('should load document model with only header if headerOnly option is set and doctitle has block attributes', () => {
    const contents = heredoc`
      // the next line sets the document id
      [#docid]
      = Document Title
      :page-layout: home

      == Section Title

      paragraph

      * list item 1
      * list item 2
      * list item 3
    `
    setInputFileContents(contents)
    const doc = loadAsciiDoc(inputFile, undefined, { headerOnly: true })
    expect(doc.getBlocks()).to.be.empty()
    expect(doc.getDocumentTitle()).to.eql('Document Title')
    expect(doc.getId()).to.eql('docid')
    expect(doc.getAttribute('page-layout')).to.eql('home')
  })

  it('should apply source style to listing block if source-language is set on document', () => {
    const contents = heredoc`
      :source-language: ruby

      ----
      puts "Hello, World!"
      ----
    `
    setInputFileContents(contents)
    const doc = loadAsciiDoc(inputFile)
    expect(doc.getBlocks()).to.have.lengthOf(1)
    expect(doc.getBlocks()[0].getStyle()).to.eql('source')
  })

  it('should load AsciiDoc contents with BOM encoded as UTF-8 characters', () => {
    const contents = heredoc`
      \xEF\xBB\xBF= Document Title

      == Section Title

      paragraph

      * list item 1
      * list item 2
      * list item 3
    `
    expect(contents.charCodeAt(0)).to.equal(239)
    expect(contents.charCodeAt(1)).to.equal(187)
    expect(contents.charCodeAt(2)).to.equal(191)
    expect(contents.charCodeAt(3)).to.equal(61)
    setInputFileContents(contents)
    const doc = loadAsciiDoc(inputFile)
    expect(doc.hasHeader()).to.be.true()
    expect(doc.getDocumentTitle()).to.equal('Document Title')
  })

  it('should load AsciiDoc contents with BOM encoded as UTF-16 character', () => {
    const contents = heredoc`
      \uFEFF= Document Title

      == Section Title

      paragraph

      * list item 1
      * list item 2
      * list item 3
    `
    expect(contents.charCodeAt(0)).to.equal(65279)
    expect(contents.charCodeAt(1)).to.equal(61)
    setInputFileContents(contents)
    const doc = loadAsciiDoc(inputFile)
    expect(doc.hasHeader()).to.be.true()
    expect(doc.getDocumentTitle()).to.equal('Document Title')
  })

  it('should not hang on mismatched passthrough syntax', () => {
    const contents = 'Link the system library `+libconfig++.so.9+` located at `+/usr/lib64/libconfig++.so.9+`.'
    const html = Asciidoctor.convert(contents, { safe: 'safe' })
    expect(html).to.include('+')
  })

  it('should not register Antora enhancements for Asciidoctor globally', () => {
    const contents = heredoc`
      = Document Title

      xref:1.0@component-b::index.adoc[Component B]

      include::does-not-resolve.adoc[]
    `
    const { lines, returnValue: html } = captureStderrSync(() =>
      Asciidoctor.convert(contents, { safe: 'safe' })
    ).withReturnValue()
    expectLink(html, '1.0@component-b::index.html', 'Component B')
    expect(html).to.include('Unresolved directive in &lt;stdin&gt; - include::does-not-resolve.adoc[]')
    expect(lines).to.have.lengthOf(1)
    expect(lines[0]).to.include('line 5: include file not found')
  })

  it('should not apply Antora enhancements if content catalog is not specified', () => {
    setInputFileContents(heredoc`
      = Page Title

      == Section Title

      // include will always be unresolved since Asciidoctor is not allowed to access filesystem
      include::partial$intro.adoc[]

      image::module-b:screenshot.png[]

      xref:more.adoc[Read more].
    `)
    const { messages, returnValue: html } = captureLogSync(() =>
      loadAsciiDoc(inputFile, undefined, resolveAsciiDocConfig()).convert()
    ).withReturnValue()
    expect(html).to.equal(heredoc`
      <div class="sect1">
      <h2 id="_section_title"><a class="anchor" href="#_section_title"></a>Section Title</h2>
      <div class="sectionbody">
      <div class="paragraph">
      <p>Unresolved include directive in modules/module-a/pages/page-a.adoc - include::partial$intro.adoc[]</p>
      </div>
      <div class="imageblock">
      <div class="content">
      <img src="module-b:screenshot.png" alt="module b:screenshot">
      </div>
      </div>
      <div class="paragraph">
      <p><a href="more.html">Read more</a>.</p>
      </div>
      </div>
      </div>
    `)
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.eql({
      level: 'error',
      name: 'asciidoctor',
      msg: 'target of include not found: partial$intro.adoc',
      file: { path: inputFile.src.path, line: 6 },
    })
  })

  it('should extend the registered html5 converter', () => {
    const contents = heredoc`
    = Page Title

    See xref:other-module:the-page.adoc[page in other module].
    `
    setInputFileContents(contents)
    const contentCatalog = mockContentCatalog({
      family: 'page',
      module: 'other-module',
      relative: 'the-page.adoc',
      contents: '= Other Page Title',
    })

    let html = loadAsciiDoc(inputFile, contentCatalog).convert()
    expect(html).to.include('<div class="paragraph">')
    expectPageLink(html, '../other-module/the-page.html', 'page in other module')

    const html5Converter = Opal.Asciidoctor.Converter.$for('html5')
    try {
      ;(() => {
        const classDef = Opal.klass(null, html5Converter, 'CustomHtml5Converter')
        classDef.$register_for('html5')
        Opal.defn(classDef, '$convert_paragraph', (node) => `<p>${node.getContent()}</p>`)
      })()
      html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(html).to.not.include('<div class="paragraph">')
      expectPageLink(html, '../other-module/the-page.html', 'page in other module')
    } finally {
      Opal.Object.$remove_const('CustomHtml5Converter')
      delete Opal.Object.CustomHtml5Converter
      delete Opal.CustomHtml5Converter
      html5Converter.$register_for('html5')
    }

    html = loadAsciiDoc(inputFile, contentCatalog).convert()
    expect(html).to.include('<div class="paragraph">')
    expectPageLink(html, '../other-module/the-page.html', 'page in other module')
  })

  it('should use UTF-8 as the default String encoding', () => {
    expect(String('foo'.encoding)).to.equal('UTF-8')
  })

  it('should return correct bytes for String', () => {
    expect('foo'.$bytesize()).to.equal(3)
    expect('foo'.$each_byte().$to_a()).to.eql([102, 111, 111])
  })

  describe('logger adapter', () => {
    it('should use null logger if logger is not enabled', () => {
      setInputFileContents('= Page Title')
      const doc = loadAsciiDoc(inputFile)
      expect(doc.getOptions().logger).to.be.undefined()
      expect(Asciidoctor.LoggerManager.getLogger()).to.be.instanceOf(Asciidoctor.NullLogger)
    })

    it('should not use null logger if logger is silent but failure level is active', () => {
      configureLogger({ level: 'silent', failureLevel: 'warn' })
      setInputFileContents('= Page Title')
      const doc = loadAsciiDoc(inputFile)
      expect(doc.getOptions().logger).to.not.be.false()
      expect(Asciidoctor.LoggerManager.getLogger()).to.not.be.instanceOf(Asciidoctor.NullLogger)
      expect(Asciidoctor.LoggerManager.getLogger().delegate.constructor.name).to.equal('Pino')
    })

    it('should mark logger to fail on exit if log failure level is reached', () => {
      const messages = []
      const rootLogger = configureLogger({
        failureLevel: 'warn',
        destination: { write: (messageString) => messages.push(messageString) },
      }).get(null)
      setInputFileContents('= Page Title\n\n2. two')
      loadAsciiDoc(inputFile).convert()
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.include('"name":"asciidoctor"')
      expect(messages[0]).to.not.include('"name":"antora"')
      expect(rootLogger.failOnExit).to.be.true()
    })

    it('should mark logger to fail on exit if log failure level is reached and log level is not enabled', () => {
      const messages = []
      const rootLogger = configureLogger({
        level: 'silent',
        failureLevel: 'warn',
        destination: { write: (messageString) => messages.push(messageString) },
      }).get(null)
      setInputFileContents('= Page Title\n\n2. two')
      loadAsciiDoc(inputFile).convert()
      expect(messages).to.be.empty()
      expect(rootLogger.failOnExit).to.be.true()
    })

    it('should not mark logger to fail on exit if log failure level is not reached and log level is not enabled', () => {
      const messages = []
      const rootLogger = configureLogger({
        level: 'silent',
        failureLevel: 'error',
        destination: { write: (messageString) => messages.push(messageString) },
      }).get(null)
      setInputFileContents('= Page Title\n\n2. two')
      loadAsciiDoc(inputFile).convert()
      expect(messages).to.be.empty()
      expect(rootLogger.failOnExit).to.be.undefined()
    })

    it('should set level to infinity when logger is silent and failure level is not silent', () => {
      configureLogger({ level: 'silent', failureLevel: 'warn' })
      setInputFileContents('= Page Title')
      loadAsciiDoc(inputFile)
      expect(Asciidoctor.LoggerManager.getLogger().level).to.equal(Infinity)
    })

    it('should set Asciidoctor log level to 0 when Antora log level is debug', () => {
      configureLogger({ level: 'debug' })
      setInputFileContents('= Page Title')
      loadAsciiDoc(inputFile)
      expect(Asciidoctor.LoggerManager.getLogger().level).to.equal(0)
    })

    it('should set Asciidoctor log failureLevel to 0 when Antora log failureLevel is debug', () => {
      configureLogger({ failureLevel: 'debug' })
      setInputFileContents('= Page Title')
      loadAsciiDoc(inputFile)
      expect(Asciidoctor.LoggerManager.getLogger().failureLevel).to.equal(0)
    })

    it('should not use message from ignored log object as next log message', () => {
      configureLogger({ level: 'warn' })
      const config = {
        attributes: { 'attribute-missing': 'drop-line' },
      }
      const contents = heredoc`
        image::{no-such-attribute}[]

        image:missing.png[]
      `
      const contentCatalog = mockContentCatalog({
        version: '',
        family: 'page',
        relative: 'page-a.adoc',
        contents,
      })
      inputFile = contentCatalog.getFiles()[0]
      const messages = captureStdoutLogSync(() => loadAsciiDoc(inputFile, contentCatalog, config).convert())
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('error')
      expect(messages[0].msg).to.equal('target of image not found: missing.png')
    })

    it('should include file and source keys in log object when Asciidoctor does not provide source location', () => {
      setInputFileContents('= Page Title\n\n{no-such-attribute}')
      inputFile.src.origin = {
        type: 'git',
        url: 'https://git.example.org/repo.git',
        refname: 'main',
        branch: 'main',
        startPath: 'docs',
      }
      const config = {
        attributes: { 'attribute-missing': 'warn' },
      }
      const messages = captureLogSync(() => loadAsciiDoc(inputFile, undefined, config).convert())
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'warn',
        name: 'asciidoctor',
        file: { path: 'docs/modules/module-a/pages/page-a.adoc' },
        source: { refname: 'main', reftype: 'branch', startPath: 'docs', url: 'https://git.example.org/repo.git' },
        msg: 'skipping reference to missing attribute: no-such-attribute',
      })
    })

    it('should invoke block if log message is provided by block', () => {
      setInputFileContents('= Page Title\n\n{no-such-attribute}')
      const config = {
        attributes: { 'attribute-missing': 'drop-line' },
      }
      const messages = captureLogSync(() => loadAsciiDoc(inputFile, undefined, config).convert())
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'info',
        name: 'asciidoctor',
        file: { path: 'modules/module-a/pages/page-a.adoc' },
        msg: 'dropping line containing reference to missing attribute: no-such-attribute',
      })
    })

    // NOTE this would only happen in an extension
    it('should process contextual log message missing the source_location property', () => {
      setInputFileContents('= Page Title')
      const messages = captureLogSync(() => {
        loadAsciiDoc(inputFile)
        Asciidoctor.LoggerManager.getLogger().$warn(Asciidoctor.Logging.createLogMessage('oops', {}))
      })
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'warn',
        name: 'asciidoctor',
        file: { path: 'modules/module-a/pages/page-a.adoc' },
        msg: 'oops',
      })
    })

    // NOTE this would only happen in an extension
    it('should log message to info level if severity is not recognized', () => {
      setInputFileContents('= Page Title')
      const messages = captureLogSync(() => {
        loadAsciiDoc(inputFile)
        Asciidoctor.LoggerManager.getLogger().$unknown('wat?')
      })
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'info',
        name: 'asciidoctor',
        file: { path: 'modules/module-a/pages/page-a.adoc' },
        msg: 'wat?',
      })
    })

    it('should use message passed as second argument to add method', () => {
      setInputFileContents('= Page Title')
      const messages = captureLogSync(() => {
        loadAsciiDoc(inputFile)
        Asciidoctor.LoggerManager.getLogger().$add(Opal.Logger.Severity.INFO, 'hello')
      })
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'info',
        name: 'asciidoctor',
        file: { path: 'modules/module-a/pages/page-a.adoc' },
        msg: 'hello',
      })
    })
  })

  describe('attributes', () => {
    it('should assign built-in and Antora integration attributes on document', () => {
      const contents = heredoc`
      [#docid.docrole]
      = Document Title
      `
      setInputFileContents(contents)
      const doc = loadAsciiDoc(inputFile, undefined, resolveAsciiDocConfig())
      expect(doc.getBaseDir()).to.equal('modules/module-a/pages')
      expect(doc.getId()).to.equal('docid')
      expect(doc.getAttributes()).to.include({
        // env
        env: 'site',
        'env-site': '',
        'site-gen': 'antora',
        'site-gen-antora': '',
        // default
        'attribute-missing': 'warn',
        icons: 'font',
        sectanchors: '',
        'source-highlighter': 'highlight.js',
        // intrinsic
        docname: 'page-a',
        docfile: 'modules/module-a/pages/page-a.adoc',
        docdir: doc.getBaseDir(),
        docfilesuffix: '.adoc',
        imagesdir: '_images',
        attachmentsdir: '_attachments',
        partialsdir: 'partial$',
        examplesdir: 'example$',
        // page
        'page-component-name': 'component-a',
        'page-component-version': '',
        'page-version': '',
        'page-module': 'module-a',
        'page-relative-src-path': 'page-a.adoc',
        // computed
        doctitle: 'Document Title',
        role: 'docrole',
        notitle: '',
        embedded: '',
        'safe-mode-name': 'safe',
        'safe-mode-safe': '',
      })
    })

    it('should not fail to compute attributes if pub.moduleRootPath property is not set on imput file', () => {
      const contents = heredoc`
      = Document Title
      `
      setInputFileContents(contents)
      delete inputFile.pub.moduleRootPath
      const doc = loadAsciiDoc(inputFile, undefined, resolveAsciiDocConfig())
      expect(doc.getAttributes()).to.include({ imagesdir: '_images', attachmentsdir: '_attachments' })
    })

    it('should not fail to compute attributes if pub property is not set on imput file', () => {
      const contents = heredoc`
      = Document Title
      `
      setInputFileContents(contents)
      delete inputFile.pub
      const doc = loadAsciiDoc(inputFile, undefined, resolveAsciiDocConfig())
      expect(doc.getAttributes()).to.include({ imagesdir: '_images', attachmentsdir: '_attachments' })
    })

    it('should assign Antora integration attributes on document for page in topic folder', () => {
      inputFile = mockContentCatalog({
        version: '4.5.6',
        family: 'page',
        relative: 'topic-a/page-a.adoc',
        contents: '= Document Title',
      }).getFiles()[0]
      const doc = loadAsciiDoc(inputFile, undefined, resolveAsciiDocConfig())
      expect(doc.getAttributes()).to.include({
        imagesdir: '../_images',
        attachmentsdir: '../_attachments',
      })
    })

    it('should set page attributes even if file is not in page family', () => {
      const inputFile = mockContentCatalog({
        version: '4.5',
        family: 'nav',
        relative: 'nav.adoc',
        contents: '* xref:module-a:index.adoc[Module A]',
      }).getFiles()[0]
      const doc = loadAsciiDoc(inputFile)
      expect(doc.getAttributes()).to.include.keys(
        'page-component-name',
        'page-component-version',
        'page-version',
        'page-module',
        'page-relative-src-path'
      )
    })

    it('should set page component title if component is found in content catalog', () => {
      const contentCatalog = mockContentCatalog({
        version: '4.5',
        family: 'page',
        relative: 'page-a.adoc',
        contents: '= Document Title',
      })
      contentCatalog.getComponent('component-a').title = 'Component A'
      const inputFile = contentCatalog.getFiles()[0]
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(doc.getAttributes()).to.include({
        'page-component-name': 'component-a',
        'page-component-title': 'Component A',
      })
    })

    it('should set page component display version if component is found in content catalog', () => {
      const contentCatalog = mockContentCatalog({
        version: '4.5',
        family: 'page',
        relative: 'page-a.adoc',
        contents: '= Document Title',
      })
      contentCatalog.getComponent('component-a').latest.displayVersion = '4.5 LTS'
      const inputFile = contentCatalog.getFiles()[0]
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(doc.getAttributes()).to.include({
        'page-component-name': 'component-a',
        'page-component-display-version': '4.5 LTS',
      })
    })

    it('should set latest version attributes for page in latest component version', () => {
      const contentCatalog = mockContentCatalog({
        version: '4.5',
        family: 'page',
        relative: 'page-a.adoc',
        contents: '= Document Title',
      })
      const inputFile = contentCatalog.getFiles()[0]
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(doc.getAttributes()).to.include({
        'page-component-latest-version': '4.5',
        'page-component-version-is-latest': '',
      })
    })

    it('should not set page-component-version-is-latest attribute if page not in latest component version', () => {
      const contentCatalog = mockContentCatalog([
        {
          version: '4.0',
          family: 'page',
          relative: 'page-a.adoc',
          contents: '= Document Title',
        },
        {
          version: '4.5',
          family: 'page',
          relative: 'page-a.adoc',
          contents: '= Document Title',
        },
      ])
      const inputFile = contentCatalog.getFiles()[0]
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(doc.getAttributes()).to.include({ 'page-component-latest-version': '4.5' })
      expect(doc.getAttributes()).to.not.have.property('page-component-version-is-latest')
    })

    it('should set page-edit-url attribute if edit URL is set on page src', () => {
      const contentCatalog = mockContentCatalog({
        version: '4.5.x',
        family: 'page',
        relative: 'page-a.adoc',
        contents: '= Document Title',
      })
      const inputFile = contentCatalog.getFiles()[0]
      inputFile.src.editUrl = 'https://git.example.org/component-a/edit/main/docs/modules/ROOT/pages/index.adoc'
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(doc.getAttributes()).to.have.property('page-edit-url', inputFile.src.editUrl)
    })

    it('should set page origin attributes if origin information is available for file from branch', () => {
      const contentCatalog = mockContentCatalog({
        version: '4.5.x',
        family: 'page',
        relative: 'page-a.adoc',
        contents: '= Document Title',
      })
      const inputFileFromBranch = contentCatalog.getFiles()[0]
      inputFileFromBranch.src.origin = {
        type: 'git',
        url: 'https://example.org/component-a.git',
        startPath: 'docs',
        reftype: 'branch',
        refname: 'v4.5.x',
        branch: 'v4.5.x',
        refhash: 'a185bc03d7c07a3a98dcd14214d884ebd6387578',
        private: true,
      }
      const docFromBranch = loadAsciiDoc(inputFileFromBranch, contentCatalog)
      expect(docFromBranch.getAttributes()).to.include({
        'page-origin-type': 'git',
        'page-origin-url': 'https://example.org/component-a.git',
        'page-origin-start-path': 'docs',
        'page-origin-branch': 'v4.5.x',
        'page-origin-refname': 'v4.5.x',
        'page-origin-reftype': 'branch',
        'page-origin-refhash': 'a185bc03d7c07a3a98dcd14214d884ebd6387578',
        'page-origin-private': '',
      })
      expect(docFromBranch.hasAttribute('page-origin-tag')).to.be.false()
      expect(docFromBranch.hasAttribute('page-origin-worktree')).to.be.false()
    })

    it('should set page origin attributes if origin information is available for file from worktree branch', () => {
      const contentCatalog = mockContentCatalog({
        version: '4.5.x',
        family: 'page',
        relative: 'page-a.adoc',
        contents: '= Document Title',
      })
      const inputFileFromBranch = contentCatalog.getFiles()[0]
      inputFileFromBranch.src.origin = {
        type: 'git',
        url: 'https://example.org/component-a.git',
        startPath: 'docs',
        reftype: 'branch',
        refname: 'v4.5.x',
        branch: 'v4.5.x',
        worktree: '/path/to/worktree',
      }
      const docFromBranch = loadAsciiDoc(inputFileFromBranch, contentCatalog)
      expect(docFromBranch.getAttributes()).to.include({
        'page-origin-type': 'git',
        'page-origin-url': 'https://example.org/component-a.git',
        'page-origin-start-path': 'docs',
        'page-origin-branch': 'v4.5.x',
        'page-origin-refname': 'v4.5.x',
        'page-origin-reftype': 'branch',
        'page-origin-refhash': '(worktree)',
        'page-origin-worktree': '/path/to/worktree',
      })
      expect(docFromBranch.hasAttribute('page-origin-private')).to.be.false()
      expect(docFromBranch.hasAttribute('page-origin-tag')).to.be.false()
    })

    it('should set page origin attributes if origin information is available for file from tag', () => {
      const contentCatalog = mockContentCatalog({
        version: '4.5.x',
        family: 'page',
        relative: 'page-a.adoc',
        contents: '= Document Title',
      })
      const inputFileFromTag = contentCatalog.getFiles()[0]
      inputFileFromTag.src.origin = {
        type: 'git',
        url: 'https://example.org/component-a.git',
        startPath: '',
        reftype: 'tag',
        refname: 'v4.5.1',
        tag: 'v4.5.1',
        refhash: 'a185bc03d7c07a3a98dcd14214d884ebd6387578',
      }
      const docFromTag = loadAsciiDoc(inputFileFromTag, contentCatalog)
      expect(docFromTag.getAttributes()).to.include({
        'page-origin-type': 'git',
        'page-origin-url': 'https://example.org/component-a.git',
        'page-origin-start-path': '',
        'page-origin-tag': 'v4.5.1',
        'page-origin-refname': 'v4.5.1',
        'page-origin-reftype': 'tag',
        'page-origin-refhash': 'a185bc03d7c07a3a98dcd14214d884ebd6387578',
      })
      expect(docFromTag.hasAttribute('page-origin-branch')).to.be.false()
      expect(docFromTag.hasAttribute('page-origin-worktree')).to.be.false()
      expect(docFromTag.hasAttribute('page-origin-private')).to.be.false()
    })

    it('should add custom attributes to document', () => {
      setInputFileContents('= Document Title')
      const config = {
        attributes: {
          'attribute-missing': 'skip',
          icons: '',
          idseparator: '-',
          'source-highlighter': 'html-pipeline',
        },
      }
      const doc = loadAsciiDoc(inputFile, undefined, config)
      expect(doc.getAttributes()).to.include(config.attributes)
    })

    it('should allow doctype option to be set on document', () => {
      setInputFileContents('contents')
      const config = { doctype: 'book' }
      const doc = loadAsciiDoc(inputFile, undefined, config)
      expect(doc.getDoctype()).to.equal('book')
      expect(doc.getBlocks()).to.have.lengthOf(1)
      expect(doc.getBlocks()[0].getContext()).to.equal('preamble')
    })

    it('should not warn when parsing header only if doctype is manpage', () => {
      const contents = heredoc`
        = cmd(1)
        Author Name
        :doctype: manpage

        == Name

        cmd - does stuff
      `
      setInputFileContents(contents)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, undefined, { headerOnly: true })
      ).withReturnValue()
      expect(messages).to.be.empty()
      expect(doc.getDoctype()).to.equal('manpage')
      expect(doc.getBlocks()).to.be.empty()
      const attributes = doc.getAttributes()
      expect(attributes.manvolnum).to.equal('1')
      expect(attributes.mantitle).to.equal('cmd')
      expect(attributes.manname).to.be.undefined()
      expect(attributes.manpurpose).to.be.undefined()
    })

    it('should assign site-url attribute if site url is set in playbook', () => {
      setInputFileContents('= Document Title')
      const playbook = {
        site: {
          url: 'https://docs.example.org',
        },
        asciidoc: {
          attributes: {
            'attribute-missing': 'skip',
            icons: '',
            idseparator: '-',
            'source-highlighter': 'html-pipeline',
          },
        },
      }
      const doc = loadAsciiDoc(inputFile, undefined, resolveAsciiDocConfig(playbook))
      const expectedAttributes = { ...playbook.asciidoc.attributes, 'site-url': 'https://docs.example.org' }
      expect(doc.getAttributes()).to.include(expectedAttributes)
    })

    it('should assign site-title attribute if site title is set in playbook', () => {
      setInputFileContents('= Document Title')
      const playbook = {
        site: {
          title: 'Docs',
        },
        asciidoc: {
          attributes: {
            'attribute-missing': 'skip',
            icons: '',
            idseparator: '-',
            'source-highlighter': 'html-pipeline',
          },
        },
      }
      const doc = loadAsciiDoc(inputFile, undefined, resolveAsciiDocConfig(playbook))
      const expectedAttributes = { ...playbook.asciidoc.attributes, 'site-title': 'Docs' }
      expect(doc.getAttributes()).to.include(expectedAttributes)
    })

    it('should not allow custom attributes to override intrinsic attributes', () => {
      setInputFileContents('= Document Title')
      const config = {
        attributes: {
          docname: 'foo',
          docfile: 'foo.asciidoc',
          docfilesuffix: '.asciidoc',
          imagesdir: 'images',
          attachmentsdir: 'attachments',
          examplesdir: 'examples',
          partialsdir: 'partials',
        },
      }
      const doc = loadAsciiDoc(inputFile, undefined, config)
      expect(doc.getAttributes()).to.not.include(config.attributes)
      expect(doc.getAttributes()).to.include({ docfile: 'modules/module-a/pages/page-a.adoc' })
    })
  })

  describe('extensions', () => {
    it('should not fail if custom extensions are null', () => {
      setInputFileContents('= Document Title')
      const doc = loadAsciiDoc(inputFile, undefined, { extensions: null })
      expect(doc.getDocumentTitle()).equals('Document Title')
    })

    it('should call custom extension to self-register with extension registry per instance', () => {
      const contents = heredoc`
        [shout]
        Release early. Release often.
      `
      setInputFileContents(contents)
      const shoutBlockExtension = function () {
        this.onContext('paragraph')
        this.process((parent, reader) =>
          this.createBlock(
            parent,
            'paragraph',
            reader.getLines().map((l) => l.toUpperCase())
          )
        )
      }
      shoutBlockExtension.registered = 0
      shoutBlockExtension.register = (registry) => {
        shoutBlockExtension.registered++
        registry.block('shout', shoutBlockExtension)
      }
      const config = { extensions: [shoutBlockExtension] }
      let html

      html = loadAsciiDoc(inputFile, undefined, config).convert()
      expect(shoutBlockExtension.registered).to.equal(1)
      expect(html).to.include('RELEASE EARLY. RELEASE OFTEN')

      html = loadAsciiDoc(inputFile, undefined, config).convert()
      expect(shoutBlockExtension.registered).to.equal(2)
      expect(html).to.include('RELEASE EARLY. RELEASE OFTEN')

      html = loadAsciiDoc(inputFile).convert()
      expect(shoutBlockExtension.registered).to.equal(2)
      expect(html).to.include('Release early. Release often.')
    })

    it('should set context on logger before calling register method on extension', () => {
      const contentCatalog = mockContentCatalog([
        { family: 'page', relative: 'page-a.adoc', contents: '= Page A' },
        { family: 'page', relative: 'page-b.adoc', contents: '= Page B' },
      ])
      const files = contentCatalog.getFiles()
      const origin = {
        type: 'git',
        url: 'https://git.example.org/repo-a.git',
        startPath: '',
        refname: 'main',
      }
      files.forEach((file) => (file.src.origin = origin))
      configureLogger()
      loadAsciiDoc(files[0])
      const extension = {
        register (registry) {
          const logger = Asciidoctor.LoggerManager.getLogger()
          console.log(logger)
          logger.info('hey there')
        },
      }
      const config = { extensions: [extension] }
      const { messages, returnValue: doc } = captureStdoutLogSync(() =>
        loadAsciiDoc(files[1], undefined, config)
      ).withReturnValue()
      expect(doc.getDocumentTitle()).to.equal('Page B')
      expect(messages).to.have.lengthOf(1)

      expect(messages[0].file.path).to.equal('modules/module-a/pages/page-b.adoc')
    })

    it('should give extension access to context that includes current file and content catalog', () => {
      setInputFileContents('files::[]')
      const contentCatalog = mockContentCatalog([
        { family: 'page', relative: 'page-a.adoc' },
        { family: 'page', relative: 'page-b.adoc' },
        { family: 'page', relative: 'page-c.adoc' },
      ])
      const config = { extensions: [require(ospath.resolve(FIXTURES_DIR, 'ext/file-report-block-macro.js'))] }
      const html = loadAsciiDoc(inputFile, contentCatalog, config).convert()
      expect(html).to.include('Files in catalog: 3')
      expect(html).to.include('URL of current page: /component-a/module-a/page-a.html')
    })
  })

  describe('include directive', () => {
    const TAGS_EXAMPLE = heredoc`
      msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }
      # tag::hello[]
      puts msgs[:hello]
      # end::hello[]
      # tag::goodbye[]
      puts msgs[:goodbye]
      # end::goodbye[]
      # tag::fin[]
      puts "anything else?"
      # end::fin[]
      `

    it('should honor optional option on include directive', () => {
      const inputContents = heredoc`
        = Document Title

        include::does-not-exist.adoc[opts=optional]

        after
      `
      setInputFileContents(inputContents)
      const { messages, returnValue: html } = captureLogSync(() => loadAsciiDoc(inputFile).convert()).withReturnValue()
      expect(html).to.not.include('Unresolved directive')
      expect(html).to.not.include('include::does-not-exist.adoc')
      expect(html).to.include('<p>after</p>')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'info',
        name: 'asciidoctor',
        file: { path: 'modules/module-a/pages/page-a.adoc', line: 3 },
        msg: 'optional include dropped because include file not found: does-not-exist.adoc',
      })
    })

    it('should skip include directive if target prefixed with {partialsdir} cannot be resolved', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const inputContents = 'include::{partialsdir}/does-not-exist.adoc[]'
      setInputFileContents(inputContents)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      expect(contentCatalog.getById).to.have.been.called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'does-not-exist.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      const expectedSource = [
        'Unresolved include directive in modules/module-a/pages/page-a.adoc',
        'include::partial$/does-not-exist.adoc[]',
      ].join(' - ')
      expect(firstBlock.getSourceLines()).to.eql([expectedSource])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of include not found: partial$/does-not-exist.adoc',
        file: { path: inputFile.src.path, line: 1 },
      })
    })

    it('should skip include directive if target resource ID cannot be resolved', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const inputContents = 'include::partial$does-not-exist.adoc[]'
      setInputFileContents(inputContents)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'does-not-exist.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      const expectedSource = [
        'Unresolved include directive in modules/module-a/pages/page-a.adoc',
        'include::partial$does-not-exist.adoc[]',
      ].join(' - ')
      expect(firstBlock.getSourceLines()).to.eql([expectedSource])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of include not found: partial$does-not-exist.adoc',
        file: { path: inputFile.src.path, line: 1 },
      })
    })

    it('should skip include directive if target resource ID has invalid syntax', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const inputContents = 'include::module-a:partial$$[]'
      setInputFileContents(inputContents)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      expect(contentCatalog.getById).to.not.have.been.called()
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      const expectedSource = [
        'Unresolved include directive in modules/module-a/pages/page-a.adoc',
        'include::module-a:partial$$[]',
      ].join(' - ')
      expect(firstBlock.getSourceLines()).to.eql([expectedSource])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of include not found: module-a:partial$$',
        file: { path: inputFile.src.path, line: 1 },
      })
    })

    it('should not clobber surrounding lines when target of include cannot be resolved', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const inputContents = 'before\ninclude::partial$does-not-exist.adoc[]\nafter'
      setInputFileContents(inputContents)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'does-not-exist.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      const expectedSource = [
        'Unresolved include directive in modules/module-a/pages/page-a.adoc',
        'include::partial$does-not-exist.adoc[]',
      ].join(' - ')
      expect(firstBlock.getSourceLines()).to.eql(['before', expectedSource, 'after'])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of include not found: partial$does-not-exist.adoc',
        file: { path: inputFile.src.path, line: 2 },
      })
    })

    it('should not remove trailing spaces from lines of a non-AsciiDoc include file', () => {
      const includeContents = ['puts "Hello"\t', 'sleep 5 ', 'puts "See ya!"  '].join('\n')
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'visit.rb',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents(['----', 'include::example$visit.rb[]', '----'].join('\n'))
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'example',
        relative: 'visit.rb',
      })
      expect(doc.getBlocks()).to.have.lengthOf(1)
      expect(doc.getBlocks()[0].getContent()).to.equal(includeContents)
    })

    it('should not drop leading and trailing empty lines of AsciiDoc include file', () => {
      const includeContents = ['', 'included content', '', ''].join('\n')
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'paragraph.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents(['before', 'include::partial$paragraph.adoc[]', 'after'].join('\n'))
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'paragraph.adoc',
      })
      expect(doc.getBlocks()).to.have.lengthOf(3)
      expect(doc.getBlocks()[1].getSourceLines()).to.eql(['included content'])
    })

    it('should not crash if contents of included file is undefined', () => {
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'undefined-contents.adoc',
      }).spyOn('getById')
      contentCatalog.getFiles()[0].contents = undefined
      setInputFileContents(heredoc`
        before
        include::partial$undefined-contents.adoc[]
        after
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'undefined-contents.adoc',
      })
      const para = doc.getBlocks()[0]
      expect(para).to.not.be.undefined()
      expect(para.getContext()).to.equal('paragraph')
      expect(para.getSourceLines()).to.eql(['before', 'after'])
    })

    it('should resolve include target prefixed with {partialsdir}', () => {
      const includeContents = 'Hello, World!'
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents('include::{partialsdir}/greeting.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([includeContents])
    })

    it('should resolve include target with resource ID in partial family', () => {
      const includeContents = 'Hello, World!'
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents('include::partial$greeting.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([includeContents])
    })

    it('should resolve include target prefixed with {examplesdir}', () => {
      const includeContents = 'puts "Hello, World!"'
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/hello.rb',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/hello.rb[]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'example',
        relative: 'ruby/hello.rb',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getStyle()).to.equal('source')
      expect(firstBlock.getSourceLines()).to.eql([includeContents])
    })

    it('should resolve include target with resource ID in example family', () => {
      const includeContents = 'puts "Hello, World!"'
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/hello.rb',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::example$ruby/hello.rb[]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'example',
        relative: 'ruby/hello.rb',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getStyle()).to.equal('source')
      expect(firstBlock.getSourceLines()).to.eql([includeContents])
    })

    it('should resolve include target with resource ID in separate module', () => {
      const includeContents = 'Hello, World!'
      const contentCatalog = mockContentCatalog({
        module: 'another-module',
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents('include::another-module:partial$greeting.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'another-module',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([includeContents])
    })

    it('should resolve correct target from resource ID if previous include is empty', () => {
      const contentCatalog = mockContentCatalog([
        { module: 'module-a', family: 'partial', relative: 'target.adoc', contents: 'from module-a' },
        { module: 'module-b', family: 'partial', relative: 'target.adoc', contents: 'from module-b' },
        { module: 'module-b', family: 'partial', relative: 'empty.adoc' },
      ]).spyOn('getById')
      setInputFileContents('include::module-b:partial$empty.adoc[]\ninclude::partial$target.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'partial',
        relative: 'empty.adoc',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'target.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getSourceLines()).to.eql(['from module-a'])
    })

    it('should resolve include target with resource ID in separate component', () => {
      const includeContents = 'Hello, World!'
      const contentCatalog = mockContentCatalog({
        component: 'another-component',
        version: '1.1',
        module: 'ROOT',
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents('include::1.1@another-component::partial$greeting.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'another-component',
        version: '1.1',
        module: 'ROOT',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([includeContents])
    })

    it('should assume family of target is page when target is resource ID in separate component', () => {
      const includeContents = 'Hello, World!'
      const contentCatalog = mockContentCatalog({
        component: 'another-component',
        version: '1.1',
        module: 'ROOT',
        family: 'page',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('resolveResource')
      setInputFileContents('include::1.1@another-component::greeting.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.resolveResource).nth(1).called.with(
        '1.1@another-component::greeting.adoc',
        {
          component: 'component-a',
          version: '',
          module: 'module-a',
          family: 'page',
          relative: 'page-a.adoc',
        },
        'page'
      )
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      const expectedSource = ['Hello, World!']
      expect(firstBlock.getSourceLines()).to.eql(expectedSource)
    })

    it('should assume family of target is page when target is resource ID in separate version', () => {
      const includeContents = 'Hello, World!'
      const contentCatalog = mockContentCatalog({
        version: '1.1',
        family: 'page',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('resolveResource')
      setInputFileContents('include::1.1@greeting.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.resolveResource).nth(1).called.with(
        '1.1@greeting.adoc',
        {
          component: 'component-a',
          version: '',
          module: 'module-a',
          family: 'page',
          relative: 'page-a.adoc',
        },
        'page'
      )
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
    })

    it('should resolve target of nested include relative to current file', () => {
      const outerIncludeContents = 'include::deeply/nested.adoc[]'
      const nestedIncludeContents = 'All that is nested is not lost.'
      const contentCatalog = mockContentCatalog([
        {
          family: 'partial',
          relative: 'outer.adoc',
          contents: outerIncludeContents,
        },
        {
          family: 'partial',
          relative: 'deeply/nested.adoc',
          contents: nestedIncludeContents,
        },
      ]).spyOn('getById', 'getByPath')
      setInputFileContents('include::{partialsdir}/outer.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'outer.adoc',
      })
      expect(contentCatalog.getByPath).nth(1).called.with({
        component: 'component-a',
        version: '',
        path: 'modules/module-a/pages/_partials/deeply/nested.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([nestedIncludeContents])
    })

    // notice that this use getByPath even though it's technically a resource ID
    it('should resolve ./ relative target of nested include relative to current file', () => {
      const outerIncludeContents = 'include::./deeply/nested.adoc[]'
      const nestedIncludeContents = 'All that is nested is not lost.'
      const contentCatalog = mockContentCatalog([
        {
          family: 'partial',
          relative: 'outer.adoc',
          contents: outerIncludeContents,
        },
        {
          family: 'partial',
          relative: 'deeply/nested.adoc',
          contents: nestedIncludeContents,
        },
      ]).spyOn('getById', 'getByPath')
      setInputFileContents('include::partial$outer.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'outer.adoc',
      })
      expect(contentCatalog.getByPath).nth(1).called.with({
        component: 'component-a',
        version: '',
        path: 'modules/module-a/pages/_partials/deeply/nested.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([nestedIncludeContents])
    })

    it('should skip nested include directive if target cannot be resolved relative to current file', () => {
      const outerIncludeContents = 'include::deeply/nested.adoc[]'
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'outer.adoc',
        contents: outerIncludeContents,
      }).spyOn('getById', 'getByPath')
      setInputFileContents('include::{partialsdir}/outer.adoc[]')
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'outer.adoc',
      })
      expect(contentCatalog.getByPath).nth(1).called.with({
        component: 'component-a',
        version: '',
        path: 'modules/module-a/pages/_partials/deeply/nested.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      const expectedSource = [
        'Unresolved include directive in modules/module-a/pages/_partials/outer.adoc',
        'include::deeply/nested.adoc[]',
      ].join(' - ')
      expect(firstBlock.getSourceLines()).to.eql([expectedSource])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of include not found: deeply/nested.adoc',
        file: { path: 'modules/module-a/pages/_partials/outer.adoc', line: 1 },
        stack: [{ file: { path: inputFile.src.path, line: 1 } }],
      })
    })

    it('should resolve relative target of nested include in separate module relative to current file', () => {
      const outerIncludeContents = 'include::deeply/nested.adoc[]'
      const nestedIncludeContents = 'All that is nested is not lost.'
      const contentCatalog = mockContentCatalog([
        {
          module: 'other-module',
          family: 'partial',
          relative: 'outer.adoc',
          contents: outerIncludeContents,
        },
        {
          module: 'other-module',
          family: 'partial',
          relative: 'deeply/nested.adoc',
          contents: nestedIncludeContents,
        },
      ]).spyOn('resolveResource', 'getByPath')
      setInputFileContents('include::other-module:partial$outer.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.resolveResource).nth(1).called.with('other-module:partial$outer.adoc', {
        component: inputFile.src.component,
        version: inputFile.src.version,
        module: inputFile.src.module,
        family: 'page',
        relative: 'page-a.adoc',
      })
      expect(contentCatalog.getByPath).nth(1).called.with({
        component: 'component-a',
        version: '',
        path: 'modules/other-module/pages/_partials/deeply/nested.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([nestedIncludeContents])
    })

    it('should resolve target resource ID of nested include in separate module relative to current file', () => {
      const outerIncludeContents = 'include::yet-another-module:partial$deeply/nested.adoc[]'
      const nestedIncludeContents = 'All that is nested is not lost.'
      const contentCatalog = mockContentCatalog([
        {
          module: 'other-module',
          family: 'partial',
          relative: 'outer.adoc',
          contents: outerIncludeContents,
        },
        {
          module: 'yet-another-module',
          family: 'partial',
          relative: 'deeply/nested.adoc',
          contents: nestedIncludeContents,
        },
      ]).spyOn('resolveResource')
      setInputFileContents('include::other-module:partial$outer.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.resolveResource).to.have.been.called.twice()
      expect(contentCatalog.resolveResource).nth(1).called.with('other-module:partial$outer.adoc', {
        component: inputFile.src.component,
        version: inputFile.src.version,
        module: inputFile.src.module,
        family: 'page',
        relative: 'page-a.adoc',
      })
      expect(contentCatalog.resolveResource).nth(2).called.with('yet-another-module:partial$deeply/nested.adoc', {
        component: 'component-a',
        version: '',
        module: 'other-module',
        family: 'partial',
        relative: 'outer.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([nestedIncludeContents])
    })

    it('should resolve relative target of nested include in separate component relative to current file', () => {
      const outerIncludeContents = 'include::deeply/nested.adoc[]'
      const nestedIncludeContents = 'All that is nested is not lost.'
      const contentCatalog = mockContentCatalog([
        {
          component: 'component-b',
          module: 'ROOT',
          family: 'partial',
          relative: 'outer.adoc',
          contents: outerIncludeContents,
        },
        {
          component: 'component-b',
          module: 'ROOT',
          family: 'partial',
          relative: 'deeply/nested.adoc',
          contents: nestedIncludeContents,
        },
      ]).spyOn('resolveResource', 'getByPath')
      setInputFileContents('include::component-b::partial$outer.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.resolveResource).nth(1).called.with('component-b::partial$outer.adoc', {
        component: inputFile.src.component,
        version: inputFile.src.version,
        module: inputFile.src.module,
        family: 'page',
        relative: 'page-a.adoc',
      })
      expect(contentCatalog.getByPath).nth(1).called.with({
        component: 'component-b',
        version: '',
        path: 'modules/ROOT/pages/_partials/deeply/nested.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([nestedIncludeContents])
    })

    // notice that this use getByPath even though it's technically a resource ID
    it('should resolve ./ relative target of nested include in separate component relative to current file', () => {
      const outerIncludeContents = 'include::./deeply/nested.adoc[]'
      const nestedIncludeContents = 'All that is nested is not lost.'
      const contentCatalog = mockContentCatalog([
        {
          component: 'component-b',
          module: 'ROOT',
          family: 'partial',
          relative: 'outer.adoc',
          contents: outerIncludeContents,
        },
        {
          component: 'component-b',
          module: 'ROOT',
          family: 'partial',
          relative: 'deeply/nested.adoc',
          contents: nestedIncludeContents,
        },
      ]).spyOn('resolveResource', 'getByPath')
      setInputFileContents('include::component-b::partial$outer.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.resolveResource).nth(1).called.with('component-b::partial$outer.adoc', {
        component: inputFile.src.component,
        version: inputFile.src.version,
        module: inputFile.src.module,
        family: 'page',
        relative: 'page-a.adoc',
      })
      expect(contentCatalog.getByPath).nth(1).called.with({
        component: 'component-b',
        version: '',
        path: 'modules/ROOT/pages/_partials/deeply/nested.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([nestedIncludeContents])
    })

    it('should resolve target resource ID of nested include from other component relative to file context', () => {
      const outerIncludeContents = 'include::another-module:partial$deeply/nested.adoc[]'
      const nestedIncludeContents = 'All that is nested is not lost.'
      const contentCatalog = mockContentCatalog([
        {
          component: 'component-b',
          module: 'ROOT',
          family: 'partial',
          relative: 'outer.adoc',
          contents: outerIncludeContents,
        },
        {
          component: 'component-b',
          module: 'another-module',
          family: 'partial',
          relative: 'deeply/nested.adoc',
          contents: nestedIncludeContents,
        },
      ]).spyOn('resolveResource')
      setInputFileContents('include::component-b::partial$outer.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.resolveResource).to.have.been.called.twice()
      expect(contentCatalog.resolveResource).nth(1).called.with('component-b::partial$outer.adoc', {
        component: inputFile.src.component,
        version: inputFile.src.version,
        module: inputFile.src.module,
        family: 'page',
        relative: 'page-a.adoc',
      })
      expect(contentCatalog.resolveResource).nth(2).called.with('another-module:partial$deeply/nested.adoc', {
        component: 'component-b',
        version: '',
        module: 'ROOT',
        family: 'partial',
        relative: 'outer.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([nestedIncludeContents])
    })

    it('should ignore current context when resolving nested include if target is qualified resource ID', () => {
      const outerIncludeContents = 'include::component-a:module-a:partial$deeply/nested.adoc[]'
      const nestedIncludeContents = 'All that is nested is not lost.'
      const contentCatalog = mockContentCatalog([
        {
          component: 'component-b',
          module: 'ROOT',
          family: 'partial',
          relative: 'outer.adoc',
          contents: outerIncludeContents,
        },
        {
          family: 'partial',
          relative: 'deeply/nested.adoc',
          contents: nestedIncludeContents,
        },
      ]).spyOn('resolveResource')
      setInputFileContents('include::component-b::partial$outer.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.resolveResource).to.have.been.called.twice()
      expect(contentCatalog.resolveResource).nth(1).called.with('component-b::partial$outer.adoc', {
        component: inputFile.src.component,
        version: inputFile.src.version,
        module: inputFile.src.module,
        family: 'page',
        relative: 'page-a.adoc',
      })
      expect(contentCatalog.resolveResource).nth(2).called.with('component-a:module-a:partial$deeply/nested.adoc', {
        component: 'component-b',
        version: '',
        module: 'ROOT',
        family: 'partial',
        relative: 'outer.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([nestedIncludeContents])
    })

    // Q should this test be moved to document-converter?
    it('should resolve URL to relative target of image in partial included from different component', () => {
      const pageContents = 'include::another-component::partial$block-image.adoc[]'
      const partialContents = 'image::screenshot.jpg[]'
      const contentCatalog = mockContentCatalog([
        {
          component: 'component-a',
          module: 'module-a',
          family: 'image',
          relative: 'screenshot.jpg',
          contents: Buffer.alloc(0),
        },
        {
          component: 'another-component',
          module: 'ROOT',
          family: 'partial',
          relative: 'block-image.adoc',
          contents: partialContents,
        },
      ])
      setInputFileContents(pageContents)
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(html).to.include('src="_images/screenshot.jpg"')
    })

    // Q should this test be moved to document-converter?
    it('should resolve URL to qualified target of image in partial included from different component', () => {
      const pageContents = 'include::another-component::partial$block-image.adoc[]'
      const partialContents = 'image::another-component::screenshot.jpg[]'
      const contentCatalog = mockContentCatalog([
        {
          component: 'another-component',
          module: 'ROOT',
          family: 'image',
          relative: 'screenshot.jpg',
          contents: Buffer.alloc(0),
        },
        {
          component: 'another-component',
          module: 'ROOT',
          family: 'partial',
          relative: 'block-image.adoc',
          contents: partialContents,
        },
      ])
      setInputFileContents(pageContents)
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(html).to.include('src="../../another-component/_images/screenshot.jpg"')
    })

    it('should skip include directive if max include depth is 0', () => {
      const includeContents = 'greetings!'
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents('include::partial$greeting.adoc[]')
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { attributes: { 'max-include-depth': 0 } })
      ).withReturnValue()
      expect(contentCatalog.getById).to.not.have.been.called()
      expect(doc.getBlocks()).to.be.empty()
      expect(messages).to.be.empty()
    })

    // FIXME adapter should not report the same entry in the stack multiple times
    it('should skip include directive if max include depth is exceeded', () => {
      const includeContents = 'greetings!\n\ninclude::partial$greeting.adoc[]'
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents('include::partial$greeting.adoc[]')
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      const maxIncludeDepth = doc.getAttribute('max-include-depth')
      expect(doc.getBlocks()).to.have.lengthOf(maxIncludeDepth)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].level).to.equal('error')
      expect(messages[0].name).to.equal('asciidoctor')
      expect(messages[0].msg).to.equal(`maximum include depth of ${maxIncludeDepth} exceeded`)
      expect(messages[0].file).to.eql({ path: 'modules/module-a/pages/_partials/greeting.adoc', line: 3 })
      const stackSize = messages[0].stack.length
      expect(messages[0].stack[stackSize - 1]).to.eql({ file: { path: inputFile.src.path, line: 1 } })
    })

    it('should honor depth set in include directive', () => {
      const includeContents = 'greetings!\n\ninclude::partial$hit-up-for-money.adoc[]'
      const contentCatalog = mockContentCatalog([
        { family: 'partial', relative: 'greeting.adoc', contents: includeContents },
        { family: 'partial', relative: 'hit-up-for-money.adoc', contents: 'Got some coin for me?' },
      ]).spyOn('getById')
      setInputFileContents('include::partial$greeting.adoc[depth=0]')
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      expect(contentCatalog.getById).to.have.been.called.once()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      expect(doc.getBlocks()).to.have.lengthOf(1)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'maximum include depth of 0 exceeded',
        file: { path: 'modules/module-a/pages/_partials/greeting.adoc', line: 3 },
        stack: [{ file: { path: inputFile.src.path, line: 1 } }],
      })
    })

    it('should not register include in document catalog', () => {
      const includeContents = 'Hello, World!'
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents('include::{partialsdir}/greeting.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      expect(doc.getCatalog().includes['$key?']('greeting')).to.be.true()
      expect(doc.getCatalog().includes['$[]']('greeting')).to.equal(Opal.nil)
    })

    it('should not mangle a page reference if reference matches rootname of include', () => {
      const includeContents = 'Hello, World!'
      const contentCatalog = mockContentCatalog([
        {
          family: 'partial',
          relative: 'greeting.adoc',
          contents: includeContents,
        },
        {
          family: 'page',
          relative: 'greeting.adoc',
        },
      ]).spyOn('getById')
      setInputFileContents('include::{partialsdir}/greeting.adoc[]\n\nsee xref:greeting.adoc#message[greeting message]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(doc.convert()).to.include('<a href="greeting.html#message"')
    })

    it('should skip and log unresolved page reference inside include file, citing top-level file if sourcemap not enabled', () => {
      const includeContents = 'before\n\nxref:does-not-exist.adoc[broken xref]\n\nafter'
      const contentCatalog = mockContentCatalog({
        component: 'another-component',
        version: '1.1',
        module: 'ROOT',
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents('include::1.1@another-component::partial$greeting.adoc[]')
      const messages = captureLogSync(() => loadAsciiDoc(inputFile, contentCatalog).convert())
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'another-component',
        version: '1.1',
        module: 'ROOT',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: does-not-exist.adoc',
        // NOTE the file and line number are wrong because the sourcemap option is not enabled on processor
        file: { path: inputFile.src.path },
      })
    })

    it('should log unresolved page reference inside include file, citing correct file and line when sourcemap is enabled', () => {
      const includeContents = 'before\n\nxref:does-not-exist.adoc[broken xref]\n\nafter'
      inputFile.src.origin = {
        type: 'git',
        url: 'https://git.example.org/repo-a.git',
        refname: 'main',
        branch: 'main',
        startPath: '',
      }
      const contentCatalog = mockContentCatalog({
        component: 'another-component',
        version: '1.1',
        module: 'ROOT',
        family: 'partial',
        relative: 'greeting.adoc',
        contents: includeContents,
      }).spyOn('getById')
      contentCatalog.getFiles()[0].src.origin = {
        type: 'git',
        url: 'https://git.example.org/repo-b.git',
        refname: 'v4.5.x',
        branch: 'v4.5.x',
        startPath: 'docs',
      }
      setInputFileContents('include::1.1@another-component::partial$greeting.adoc[]')
      const messages = captureLogSync(() => loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert())
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'another-component',
        version: '1.1',
        module: 'ROOT',
        family: 'partial',
        relative: 'greeting.adoc',
      })
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: does-not-exist.adoc',
        file: { path: 'docs/modules/ROOT/pages/_partials/greeting.adoc', line: 3 },
        source: { refname: 'v4.5.x', reftype: 'branch', startPath: 'docs', url: 'https://git.example.org/repo-b.git' },
        stack: [
          {
            file: { path: inputFile.src.path, line: 1 },
            source: { refname: 'main', reftype: 'branch', url: 'https://git.example.org/repo-a.git' },
          },
        ],
      })
    })

    it('should not apply linenum filtering to contents of include if lines attribute is empty', () => {
      const includeContents = heredoc`
        puts 1
        puts 2
        puts 3
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines=]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n'))
    })

    it('should not apply linenum filtering to contents of include if lines attribute has empty values', () => {
      const includeContents = heredoc`
        puts 1
        puts 2
        puts 3
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines=;]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n'))
    })

    it('should apply linenum filtering to contents of include if lines separated by semi-colons are specified', () => {
      const includeContents = heredoc`
        # hello
        puts "Hello, World!"
        # goodbye
        puts "Goodbye, World!"
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines=2;4]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n').filter((l) => l.charAt() !== '#'))
    })

    it('should apply linenum filtering to contents of include if lines separated by commas are specified', () => {
      const includeContents = heredoc`
        # hello
        puts "Hello, World!"
        # goodbye
        puts "Goodbye, World!"
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines="2,4"]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n').filter((l) => l.charAt() !== '#'))
    })

    it('should ignore redundant values in lines attribute when applying linenum filtering', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        # waiting...
        # waiting...
        puts "Hello, World!"
        # the wait is over
        # fin
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines=4;1;1]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n').filter((l) => l.charAt() !== '#'))
    })

    it('should include all lines in range when applying linenum filtering', () => {
      const includeContents = heredoc`
        # warming up
        puts "Please stand by..."
        puts "Hello, World!"
        puts "Goodbye, World!"
        # fin
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines=2..4]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n').filter((l) => l.charAt() !== '#'))
    })

    it('should include all remaining lines when applying linenum filtering when end value is -1', () => {
      const includeContents = heredoc`
        # warming up
        puts "Please stand by..."
        puts "Hello, World!"
        puts "Goodbye, World!"
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines=2..-1]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n').filter((l) => l.charAt() !== '#'))
    })

    it('should include all remaining lines when applying linenum filtering when end value is not specified', () => {
      const includeContents = heredoc`
        # warming up
        puts "Please stand by..."
        puts "Hello, World!"
        puts "Goodbye, World!"
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines=2..]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n').filter((l) => l.charAt() !== '#'))
    })

    it('should filter out all lines when line number filtering if start value is negative', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        puts "Hello, World!"
        puts "Goodbye, World!"
        # fin
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[lines=-1..3]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.be.empty()
    })

    it('should not apply tag filtering to contents of include if tag attribute is empty', () => {
      const includeContents = TAGS_EXAMPLE
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tag=]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n'))
    })

    it('should not apply tag filtering to contents of include if tags attribute is empty', () => {
      const includeContents = TAGS_EXAMPLE
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n'))
    })

    it('should not apply tag filtering to contents of include if tags attribute has empty values', () => {
      const includeContents = TAGS_EXAMPLE
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=;]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n'))
    })

    it('should apply tag filtering to contents of include if tag is specified', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tag=hello]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts msgs[:hello]'])
    })

    it('should not drop leading and trailing empty lines inside a tagged region of AsciiDoc include file', () => {
      const includeContents = ['preamble', 'tag::main[]', '', 'included content', '', 'end::main[]', 'trailer'].join(
        '\n'
      )
      const contentCatalog = mockContentCatalog({
        family: 'partial',
        relative: 'paragraph.adoc',
        contents: includeContents,
      }).spyOn('getById')
      setInputFileContents(['before', 'include::partial$paragraph.adoc[tag=main]', 'after'].join('\n'))
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'partial',
        relative: 'paragraph.adoc',
      })
      expect(doc.getBlocks()).to.have.lengthOf(3)
      expect(doc.getBlocks()[1].getSourceLines()).to.eql(['included content'])
    })

    it('should match tag directives enclosed in circumfix comments', () => {
      const cssContents = heredoc`
        /* tag::snippet[] */
        header { color: red; }
        /* end::snippet[] */
      `
      const mlContents = heredoc`
        (* tag::snippet[] *)
        let s = SS.empty;;
        (* end::snippet[] *)
      `
      const contentCatalog = mockContentCatalog([
        { family: 'example', relative: 'theme.css', contents: cssContents },
        { family: 'example', relative: 'empty.ml', contents: mlContents },
      ])
      setInputFileContents(heredoc`
        ----
        include::{examplesdir}/theme.css[tag=snippet]
        ----

        ----
        include::{examplesdir}/empty.ml[tag=snippet]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(doc.getBlocks()).to.have.lengthOf(2)
      const block0 = doc.getBlocks()[0]
      expect(block0.getContext()).to.equal('listing')
      expect(block0.getSourceLines()).to.eql([cssContents.split('\n')[1]])
      const block1 = doc.getBlocks()[1]
      expect(block1.getContext()).to.equal('listing')
      expect(block1.getSourceLines()).to.eql([mlContents.split('\n')[1]])
    })

    it('should apply tag filtering to contents of include if negated tag is specified', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tag=!hello]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([
        'msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }',
        'puts msgs[:goodbye]',
        'puts "anything else?"',
      ])
    })

    it('should apply tag filtering to contents of include if tags separated by semi-colons are specified', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=hello;goodbye]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts msgs[:hello]', 'puts msgs[:goodbye]'])
    })

    it('should apply tag filtering to contents of include if tags separated by commas are specified', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags="hello,goodbye"]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts msgs[:hello]', 'puts msgs[:goodbye]'])
    })

    it('should split include tag on comma if present and ignore semi-colons', () => {
      const includeContents = heredoc`
        # tag::hello[]
        puts "Hello, World!"
        # end::hello[]
        # tag::goodbye;adios[]
        puts "Goodbye, World!"
        # end::goodbye;adios[]
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags="hello,goodbye;adios"]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n').filter((l) => l.charAt() !== '#'))
    })

    it('should apply tag filtering to contents of include if negated tags are specified', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=*;!goodbye]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts msgs[:hello]', 'puts "anything else?"'])
    })

    it('should include nested tags when applying tag filtering to contents of include', () => {
      const includeContents = heredoc`
        # tag::decl[]
        msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }
        # end::decl[]
        # tag::output[]
        # tag::hello[]
        puts msgs[:hello]
        # end::hello[]
        # tag::goodbye[]
        puts msgs[:goodbye]
        # end::goodbye[]
        # end::output[]
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=decl;output;!hello]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([
        'msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }',
        'puts msgs[:goodbye]',
      ])
    })

    it('should skip redundant tags in include file', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        # tag::hello[]
        # tag::hello[]
        puts "Hello, World!"
        # end::hello[]
        # end::hello[]
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tag=*]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts "Hello, World!"'])
    })

    it('should not select nested tag if outer tag is unselected', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        # tag::hello[]
        # tag::futile[]
        puts "Hello, World!"
        # end::futile[]
        # end::hello[]
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=*;!hello]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([])
    })

    it('should exclude nested tags if tag is followed by negated wildcard', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        # tag::hello[]
        puts "Hello, World!"
        # tag::go[]
        puts "Let's go!"
        # end::go[]
        # end::hello[]
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=hello;!*]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts "Hello, World!"'])
    })

    it('should handle mismatched end tag in include file', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        # tag::hello[]
        puts "Hello, World!"
        # tag::goodbye[]
        # end::hello[]
        puts "Goodbye, World!"
        # end::goodbye[]
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=hello;goodbye]
        ----
      `)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts "Hello, World!"', 'puts "Goodbye, World!"'])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'warn',
        name: 'asciidoctor',
        msg: "mismatched end tag (expected 'goodbye' but found 'hello') at line 5 of include file",
        file: { path: 'modules/module-a/examples/ruby/greet.rb', line: 5 },
        stack: [{ file: { path: inputFile.src.path, line: 3 } }],
      })
    })

    it('should skip redundant end tag in include file', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        # tag::hello[]
        puts "Hello, World!"
        # end::hello[]
        # end::hello[]
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tag=hello]
        ----
      `)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts "Hello, World!"'])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'warn',
        name: 'asciidoctor',
        msg: "unexpected end tag 'hello' at line 5 of include file",
        file: { path: 'modules/module-a/examples/ruby/greet.rb', line: 5 },
        stack: [{ file: { path: inputFile.src.path, line: 3 } }],
      })
    })

    it('should warn if include tag is unclosed', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        # tag::hello[]
        puts "Hello, World!"
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tag=hello]
        ----
      `)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts "Hello, World!"'])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'warn',
        name: 'asciidoctor',
        msg: "detected unclosed tag 'hello' starting at line 2 of include file",
        file: { path: 'modules/module-a/examples/ruby/greet.rb', line: 2 },
        stack: [{ file: { path: inputFile.src.path, line: 3 } }],
      })
    })

    it('should warn if requested include tag is not found', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        puts "Hello, World!"
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=hello;yo]
        ----
      `)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'warn',
        name: 'asciidoctor',
        msg: "tags 'hello, yo' not found in include file",
        file: { path: 'modules/module-a/examples/ruby/greet.rb' },
        stack: [{ file: { path: inputFile.src.path, line: 3 } }],
      })
    })

    it('should not warn if negated include tag is not found', () => {
      const includeContents = heredoc`
        puts "Please stand by..."
        puts "Hello, World!"
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tag=!no-such-tag]
        ----
      `)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n'))
      expect(messages).to.be.empty()
    })

    it('should not warn if negated include tags are not found', () => {
      const includeContents = heredoc`
        # tag::all[]
        puts "Please stand by..."
        puts "Hello, World!"
        # end::all[]
      `
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: includeContents,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=all;!no-such-tag;!unknown-tag]
        ----
      `)
      const { messages, returnValue: doc } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog)
      ).withReturnValue()
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(includeContents.split('\n').slice(1, -1))
      expect(messages).to.be.empty()
    })

    it('should include all lines except for tag directives when tag wildcard is specified', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=**]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([
        'msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }',
        'puts msgs[:hello]',
        'puts msgs[:goodbye]',
        'puts "anything else?"',
      ])
    })

    it('should include all regions marked with tags when only tag wildcard is specified', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=*]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['puts msgs[:hello]', 'puts msgs[:goodbye]', 'puts "anything else?"'])
    })

    it('should include lines outside of tags if tag wildcard is specified along with specific tags', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=**;!*;goodbye]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([
        'msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }',
        'puts msgs[:goodbye]',
      ])
    })

    it('should include lines outside of tags if negated tag wildcard is specified along with specific tags', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=!*;goodbye]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([
        'msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }',
        'puts msgs[:goodbye]',
      ])
    })

    it('should not include lines inside tag that has been included then excluded', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=!*;goodbye;!goodbye]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql(['msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }'])
    })

    it('should include all lines except for negated tag when tags only contains negated tag', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=!hello]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([
        'msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }',
        'puts msgs[:goodbye]',
        'puts "anything else?"',
      ])
    })

    it('should include all lines except for negated tags when tags only contains negated tags', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=!hello;!goodbye]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([
        'msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }',
        'puts "anything else?"',
      ])
    })

    it('should recognize tag wildcard if not at start of list of tags', () => {
      const contentCatalog = mockContentCatalog({
        family: 'example',
        relative: 'ruby/greet.rb',
        contents: TAGS_EXAMPLE,
      })
      setInputFileContents(heredoc`
        [source,ruby]
        ----
        include::{examplesdir}/ruby/greet.rb[tags=hello;**;*;!goodbye]
        ----
      `)
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('listing')
      expect(firstBlock.getSourceLines()).to.eql([
        'msgs = { hello: "Hello, World!", goodbye: "Goodbye, World!" }',
        'puts msgs[:hello]',
        'puts "anything else?"',
      ])
    })

    it('should resolve target of top-level include relative to current page', () => {
      const includeContents = 'changelog'
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'changelog.adoc',
        contents: includeContents,
      }).spyOn('getByPath')
      setInputFileContents('include::changelog.adoc[]')
      const doc = loadAsciiDoc(inputFile, contentCatalog)
      expect(contentCatalog.getByPath).nth(1).called.with({
        component: 'component-a',
        version: '',
        path: 'modules/module-a/pages/changelog.adoc',
      })
      const firstBlock = doc.getBlocks()[0]
      expect(firstBlock).to.not.be.undefined()
      expect(firstBlock.getContext()).to.equal('paragraph')
      expect(firstBlock.getSourceLines()).to.eql([includeContents])
    })
  })

  describe('page reference macro', () => {
    it('should skip and log invalid page reference with explicit content', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      setInputFileContents('xref:component-b::.adoc[The Page Title]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).to.not.have.been.called()
      expectUnresolvedPageLink(html, '#component-b::.adoc', 'The Page Title')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: component-b::.adoc',
        file: { path: inputFile.src.path },
      })
    })

    it('should skip and log invalid page reference with fragment and explicit content', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      setInputFileContents('xref:component-b::#frag[The Page Title]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).to.not.have.been.called()
      expectUnresolvedPageLink(html, '#component-b::.adoc#frag', 'The Page Title')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: component-b::.adoc#frag',
        file: { path: inputFile.src.path },
      })
    })

    it('should skip and log invalid page reference with empty content', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      setInputFileContents('xref:component-b::#frag[]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).to.not.have.been.called()
      expectUnresolvedPageLink(html, '#component-b::.adoc#frag', 'component-b::.adoc#frag')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: component-b::.adoc#frag',
        file: { path: inputFile.src.path },
      })
    })

    it('should delegate to built-in converter to process an internal reference', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      setInputFileContents('xref:section-a[]\n\n== Section A')
      const config = {
        attributes: { idprefix: '', idseparator: '-' },
      }
      const html = loadAsciiDoc(inputFile, contentCatalog, config).convert()
      expect(contentCatalog.getById).to.not.have.been.called()
      expectLink(html, '#section-a', 'Section A')
    })

    it('should resolve internal reference properly if path attribute is set on document', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        module: 'other-module',
        relative: 'the-page.adoc',
        contents: '= Other Page Title',
      }).spyOn('getById')
      setInputFileContents(heredoc`
        = Page Title
        :path: other-module:the-page.adoc

        xref:section-a[]

        == Section A
      `)
      const config = {
        attributes: { idprefix: '', idseparator: '-' },
      }
      const html = loadAsciiDoc(inputFile, contentCatalog, config).convert()
      expectLink(html, '#section-a', 'Section A')
      expect(contentCatalog.getById).to.not.have.been.called()
    })

    it('should break circular reference by delegating to built-in converter to process an internal reference', () => {
      const contentCatalog = mockContentCatalog({ family: 'page', relative: 'page-a.adoc' }).spyOn('getById')
      const contents = heredoc`
      = Document Title

      [#a]
      == A xref:page$page-a.adoc#b[]

      [#b]
      == B xref:page$page-a.adoc#a[]
      `
      setInputFileContents(contents)
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'page-a.adoc',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'page-a.adoc',
      })
      expect(html).to.include('<h2 id="a">A <a href="#b">B [a]</a></h2>')
      expect(html).to.include('<h2 id="b">B <a href="#a">[a]</a></h2>')
    })

    it('should not allow path document attribute to interfere with internal reference', () => {
      const contents = heredoc`
      = Document Title
      :path: that-section

      See <<that-section>>

      [#that-section]
      == That Section

      contents
      `
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        {
          family: 'page',
          relative: 'that-section.adoc',
          contents: '= Not That Section',
        },
      ])
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expectLink(html, '#that-section', 'That Section')
    })

    it('should not crash if target of shorthand xref is a URL', () => {
      const contents = heredoc`
      = Document Title

      See <<https://example.org, Example>>
      `
      setInputFileContents(contents)
      const html = loadAsciiDoc(inputFile).convert()
      expectLink(html, '#https://example.org', 'Example')
    })

    it('should delegate to built-in converter to process a normal link', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      setInputFileContents('https://example.com[Example Domain]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).to.not.have.been.called()
      expectLink(html, 'https://example.com', 'Example Domain')
    })

    it('should skip and log unresolved page reference with explicit content', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const refSpec = '4.5.6@component-b:module-b:topic-foo/topic-bar/the-page.adoc'
      setInputFileContents(`xref:${refSpec}[The Page Title]`)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'topic-foo/topic-bar/the-page.adoc',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'alias',
        relative: 'topic-foo/topic-bar/the-page.adoc',
      })
      expectUnresolvedPageLink(html, `#${refSpec}`, 'The Page Title')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: `target of xref not found: ${refSpec}`,
        file: { path: inputFile.src.path },
      })
    })

    it('should log line number where paragraph with unresolved page reference starts when sourcemap is enabled', () => {
      const contentCatalog = mockContentCatalog()
      const inputContents = heredoc`
        = Document Title

        This is a paragraph with multiple sentences.
        Each sentence is placed on it's own line.
        The last line has an xref:invalid-xref.adoc[invalid xref].
      `
      setInputFileContents(inputContents)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert()
      ).withReturnValue()
      expectUnresolvedPageLink(html, '#invalid-xref.adoc', 'invalid xref')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: invalid-xref.adoc',
        file: { path: inputFile.src.path, line: 3 },
      })
    })

    it('should log line number of list item with unresolved page reference when sourcemap is enabled', () => {
      const contentCatalog = mockContentCatalog()
      const inputContents = heredoc`
        = Document Title

        * This is an unordered list.
        * Each item is placed on it's own line and preceded with a list marker.
        * The last item has an xref:invalid-xref.adoc[invalid xref].
      `
      setInputFileContents(inputContents)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert()
      ).withReturnValue()
      expectUnresolvedPageLink(html, '#invalid-xref.adoc', 'invalid xref')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: invalid-xref.adoc',
        file: { path: inputFile.src.path, line: 5 },
      })
    })

    it('should log line number of unresolved page reference in section title when sourcemap is enabled', () => {
      const contentCatalog = mockContentCatalog()
      const inputContents = heredoc`
        = Document Title

        == xref:missing-page.adoc[runtime] keys

        This category is for configuring the runtime settings.
      `
      setInputFileContents(inputContents)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert()
      ).withReturnValue()
      expectUnresolvedPageLink(html, '#missing-page.adoc', 'runtime')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: missing-page.adoc',
        file: { path: inputFile.src.path, line: 3 },
      })
    })

    it('should log line number of unresolved page reference in header as line 1 when sourcemap is enabled', () => {
      const contentCatalog = mockContentCatalog()
      const inputContents = heredoc`
        = Document Title
        :attr-name: attr-value
        :invalid-xref: pass:n[xref:invalid-xref.adoc[invalid xref]]

        Behold, an {invalid-xref} lies here.
      `
      setInputFileContents(inputContents)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert()
      ).withReturnValue()
      expectUnresolvedPageLink(html, '#invalid-xref.adoc', 'invalid xref')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: invalid-xref.adoc',
        file: { path: inputFile.src.path, line: 1 },
      })
    })

    it('should skip and log unresolved page reference with empty content', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const refSpec = '4.5.6@component-b:module-b:topic-foo/topic-bar/the-page.adoc'
      setInputFileContents(`xref:${refSpec}[]`)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'topic-foo/topic-bar/the-page.adoc',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'alias',
        relative: 'topic-foo/topic-bar/the-page.adoc',
      })
      expectUnresolvedPageLink(html, `#${refSpec}`, refSpec)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: `target of xref not found: ${refSpec}`,
        file: { path: inputFile.src.path },
      })
    })

    it('should skip and log unresolved page reference with fragment and explicit content', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const refSpec = '4.5.6@component-b:module-b:topic-foo/topic-bar/the-page.adoc#frag'
      setInputFileContents(`xref:${refSpec}[The Page Title]`)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'topic-foo/topic-bar/the-page.adoc',
      })
      expectUnresolvedPageLink(html, `#${refSpec}`, 'The Page Title')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: `target of xref not found: ${refSpec}`,
        file: { path: inputFile.src.path },
      })
    })

    it('should skip and log unresolved page reference with fragment and empty content', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const refSpec = '4.5.6@component-b:module-b:topic-foo/topic-bar/the-page.adoc#frag'
      setInputFileContents(`xref:${refSpec}[]`)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'topic-foo/topic-bar/the-page.adoc',
      })
      expectUnresolvedPageLink(html, `#${refSpec}`, refSpec)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: `target of xref not found: ${refSpec}`,
        file: { path: inputFile.src.path },
      })
    })

    it('should skip and log multiple unresolved page references in same paragraph', () => {
      const contentCatalog = mockContentCatalog().spyOn('getById')
      setInputFileContents('See xref:this-missing-page.adoc[this]\nor see xref:that-missing-page.adoc[that].')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-missing-page.adoc',
      })
      expect(contentCatalog.getById).nth(3).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'that-missing-page.adoc',
      })
      expectUnresolvedPageLink(html, '#this-missing-page.adoc', 'this')
      expectUnresolvedPageLink(html, '#that-missing-page.adoc', 'that')
      expect(messages).to.have.lengthOf(2)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: this-missing-page.adoc',
        file: { path: inputFile.src.path },
      })
      expect(messages[1]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: that-missing-page.adoc',
        file: { path: inputFile.src.path },
      })
    })

    it('should skip and log page reference with double .adoc file extension', () => {
      const contentCatalog = mockContentCatalog({
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:the-page.adoc.adoc[The Page Title]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc.adoc',
      })
      expectUnresolvedPageLink(html, '#the-page.adoc.adoc', 'The Page Title')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: the-page.adoc.adoc',
        file: { path: inputFile.src.path },
      })
    })

    it('should skip and log page reference to non-publishable page', () => {
      const contentCatalog = mockContentCatalog({ relative: '_hidden.adoc' }).spyOn('getById')
      setInputFileContents('xref:_hidden.adoc[Hidden Page]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: '_hidden.adoc',
      })
      expectUnresolvedPageLink(html, '#_hidden.adoc', 'Hidden Page')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: _hidden.adoc',
        file: { path: inputFile.src.path },
      })
    })

    it('should convert a page reference with version, component, module, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@component-b:module-b:the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, inputFile.pub.rootPath + '/component-b/4.5.6/module-b/the-page.html', 'The Page Title')
    })

    it('should convert a fully-qualified page reference', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'topic-foo/topic-bar/the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@component-b:module-b:page$topic-foo/topic-bar/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'topic-foo/topic-bar/the-page.adoc',
      })
      expectPageLink(
        html,
        inputFile.pub.rootPath + '/component-b/4.5.6/module-b/topic-foo/topic-bar/the-page.html',
        'The Page Title'
      )
    })

    it('should convert a fully-qualified page reference with fragment', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'topic-foo/the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@component-b:module-b:topic-foo/the-page.adoc#frag[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'topic-foo/the-page.adoc',
      })
      expectPageLink(
        html,
        inputFile.pub.rootPath + '/component-b/4.5.6/module-b/topic-foo/the-page.html#frag',
        'The Page Title'
      )
    })

    it('should convert a page reference with version, module, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@module-b:the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, '../4.5.6/module-b/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with version, module, topic, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@module-b:the-topic/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, '../4.5.6/module-b/the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with version, component, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '4.5.6',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@component-b::the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, inputFile.pub.rootPath + '/component-b/4.5.6/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with version, component, topic, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '4.5.6',
        module: 'ROOT',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@component-b::the-topic/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '4.5.6',
        module: 'ROOT',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, inputFile.pub.rootPath + '/component-b/4.5.6/the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with component and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '1.1',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById', 'getComponent')
      setInputFileContents('xref:component-b::the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getComponent).nth(1).called.with('component-a')
      expect(contentCatalog.getComponent).nth(2).called.with('component-b')
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '1.1',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, inputFile.pub.rootPath + '/component-b/1.1/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with component, topic, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '1.0',
        module: 'ROOT',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById', 'getComponent')
      setInputFileContents('xref:component-b::the-topic/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getComponent).nth(1).called.with('component-a')
      expect(contentCatalog.getComponent).nth(2).called.with('component-b')
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '1.0',
        module: 'ROOT',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, inputFile.pub.rootPath + '/component-b/1.0/the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with component, module, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '2.0',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById', 'getComponent')
      setInputFileContents('xref:component-b:module-b:the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getComponent).nth(1).called.with('component-a')
      expect(contentCatalog.getComponent).nth(2).called.with('component-b')
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '2.0',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, inputFile.pub.rootPath + '/component-b/2.0/module-b/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with component, module, topic, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById', 'getComponent')
      setInputFileContents('xref:component-b:module-b:the-topic/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getComponent).nth(1).called.with('component-a')
      expect(contentCatalog.getComponent).nth(2).called.with('component-b')
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, inputFile.pub.rootPath + '/component-b/module-b/the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with component, master version, module, topic, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-b',
        version: 'master',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById', 'getComponent')
      setInputFileContents('xref:component-b:module-b:the-topic/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getComponent).nth(1).called.with('component-a')
      expect(contentCatalog.getComponent).nth(2).called.with('component-b')
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-b',
        version: 'master',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, inputFile.pub.rootPath + '/component-b/module-b/the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with version and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, '../4.5.6/module-a/the-page.html', 'The Page Title')
    })

    it('should convert a page reference having a path that starts with @', () => {
      const contentCatalog = mockContentCatalog({ relative: '@the-page.adoc' }).spyOn('getById')
      setInputFileContents('xref:module-a:@the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: '@the-page.adoc',
      })
      expectPageLink(html, '@the-page.html', 'The Page Title')
    })

    it('should convert a page reference having a path that starts with @ and a version', () => {
      const contentCatalog = mockContentCatalog({
        version: '5.6.4',
        relative: '@the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:5.6.4@@the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '5.6.4',
        module: 'module-a',
        family: 'page',
        relative: '@the-page.adoc',
      })
      expectPageLink(html, '../5.6.4/module-a/@the-page.html', 'The Page Title')
    })

    it('should convert a page reference with version, topic, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-a',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:4.5.6@the-topic/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-a',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, '../4.5.6/module-a/the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with version, topic, and page where page is relative to the current page', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'the-topic/the-page.adoc',
          contents: 'xref:4.5.6@./the-page.adoc[The Page Title]',
        },
        {
          component: 'component-a',
          version: '4.5.6',
          module: 'module-a',
          family: 'page',
          relative: 'the-topic/the-page.adoc',
        },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '4.5.6',
        module: 'module-a',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, '../../4.5.6/module-a/the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with module and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:module-b:the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, '../module-b/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with module, topic, and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:module-b:the-topic/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, '../module-b/the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a basic page reference', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, 'the-page.html', 'The Page Title')
    })

    it('should convert a basic page reference relative to the current top-level page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:./the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, 'the-page.html', 'The Page Title')
    })

    it('should convert a page reference that contains spaces', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'i like spaces.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:i like spaces.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'i like spaces.adoc',
      })
      expectPageLink(html, 'i%20like%20spaces.html', 'The Page Title')
    })

    it('should convert a basic page reference from within topic', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'the-topic/the-page.adoc',
          contents: 'xref:the-page.adoc[The Page Title]',
        },
        {
          family: 'page',
          relative: 'the-page.adoc',
        },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, '../the-page.html', 'The Page Title')
    })

    it('should convert a basic page reference relative to the current page within a topic', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'the-topic/the-page.adoc',
          contents: 'xref:./the-sibling-page.adoc[The Page Title]',
        },
        {
          family: 'page',
          relative: 'the-topic/the-sibling-page.adoc',
        },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-topic/the-sibling-page.adoc',
      })
      expectPageLink(html, 'the-sibling-page.html', 'The Page Title')
    })

    it('should convert sibling page reference without a file extension and empty fragment', () => {
      const contentCatalog = mockContentCatalog({
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:the-page#[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expectPageLink(html, 'the-page.html', 'The Page Title')
    })

    it('should skip and log page reference with a version but without a file extension', () => {
      const contentCatalog = mockContentCatalog({
        version: '2.0',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:2.0@the-page#[The Page Title]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '2.0',
        module: 'module-a',
        family: 'page',
        relative: 'the-page',
      })
      expectUnresolvedPageLink(html, '#2.0@the-page', 'The Page Title')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref not found: 2.0@the-page',
        file: { path: inputFile.src.path },
      })
    })

    it('should convert a page reference to a non-AsciiDoc page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.html',
        mediaType: 'text/html',
      }).spyOn('getById')
      setInputFileContents('xref:the-page.html[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.html',
      })
      expectPageLink(html, 'the-page.html', 'The Page Title')
    })

    it('should convert a reference to a non-page resource', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'attachment',
        relative: 'sample.zip',
        mediaType: 'application/zip',
      }).spyOn('getById')
      setInputFileContents('xref:attachment$sample.zip[The Sample]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'attachment',
        relative: 'sample.zip',
      })
      expectLink(html, '_attachments/sample.zip', 'The Sample', 'xref attachment')
    })

    it('should pass on attributes defined in xref macro', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:the-page.adoc[The Page Title,role=secret,opts=nofollow]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expect(html).to.include('<a href="the-page.html" class="xref page secret" rel="nofollow">The Page Title</a>')
    })

    it('should convert a page reference with topic and page', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:the-topic/the-page.adoc[The Page Title]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, 'the-topic/the-page.html', 'The Page Title')
    })

    it('should convert a page reference with sibling topic and page', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'topic-a/the-page.adoc',
          contents: 'xref:topic-b/the-page.adoc[The Page Title]',
        },
        {
          family: 'page',
          relative: 'topic-b/the-page.adoc',
        },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'topic-b/the-page.adoc',
      })
      expectPageLink(html, '../topic-b/the-page.html', 'The Page Title')
    })

    it('should convert a page reference to self', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc[Link to Self]',
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectPageLink(html, 'this-page.html', 'Link to Self')
    })

    it('should convert a page reference to self with empty fragment', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc#[Link to Self]',
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectPageLink(html, 'this-page.html', 'Link to Self')
    })

    it('should convert a page reference to self without fragment', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc[Link to Self]',
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectPageLink(html, 'this-page.html', 'Link to Self')
    })

    it('should convert a deep page reference to self to internal reference', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc#the-fragment[Deep Link to Self]\n\n[#the-fragment]\n== Target Section',
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectLink(html, '#the-fragment', 'Deep Link to Self')
    })

    it('should convert a deep page reference to self to internal reference with implicit content', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc#the-fragment[]\n\n[#the-fragment]\n== Target Section',
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectLink(html, '#the-fragment', 'Target Section')
    })

    it('should convert a deep page reference to self to internal reference when matches docname', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:this-page.adoc#the-fragment[Deep Link to Self]',
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).to.not.have.been.called()
      expectLink(html, '#the-fragment', 'Deep Link to Self')
    })

    it('should convert a page reference to a root relative path if relativizeResourceRefs is disabled', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'this-page.adoc',
          contents: 'xref:that-page.adoc[The Page Title]',
        },
        {
          family: 'page',
          relative: 'that-page.adoc',
        },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog, { relativizeResourceRefs: false }).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'that-page.adoc',
      })
      expectPageLink(html, '/component-a/module-a/that-page.html', 'The Page Title')
    })

    it('should convert a page reference with module and page using indexified URLs', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'this-page.adoc',
          contents: 'xref:module-b:that-page.adoc[The Page Title]',
          indexify: true,
        },
        {
          module: 'module-b',
          family: 'page',
          relative: 'that-page.adoc',
          indexify: true,
        },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      expect(inputFile.pub.moduleRootPath).to.equal('..')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'that-page.adoc',
      })
      expectPageLink(html, '../../module-b/that-page/', 'The Page Title')
    })

    it('should convert a page reference with topic and page using indexified URLs', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'this-page.adoc',
          contents: 'xref:the-topic/that-page.adoc[The Page Title]',
          indexify: true,
        },
        {
          family: 'page',
          relative: 'the-topic/that-page.adoc',
          indexify: true,
        },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-topic/that-page.adoc',
      })
      expectPageLink(html, '../the-topic/that-page/', 'The Page Title')
    })

    it('should convert a basic page reference from within a topic using indexified URLs', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'topic-a/this-page.adoc',
          contents: 'xref:that-page.adoc[The Page Title]',
          indexify: true,
        },
        {
          family: 'page',
          relative: 'that-page.adoc',
          indexify: true,
        },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      expect(inputFile.pub.moduleRootPath).to.equal('../..')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'that-page.adoc',
      })
      expectPageLink(html, '../../that-page/', 'The Page Title')
    })

    it('should convert a page reference to self using indexified URLs', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc[Link to Self]',
        indexify: true,
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectPageLink(html, './', 'Link to Self')
    })

    it('should convert a page reference to self with empty fragment using indexified URLs', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc#[Link to Self]',
        indexify: true,
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectPageLink(html, './', 'Link to Self')
    })

    it('should convert a deep page reference to self using indexified URLs', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc#the-fragment[Deep Link to Self]',
        indexify: true,
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectLink(html, '#the-fragment', 'Deep Link to Self')
    })

    it('should convert a page reference to self that matches docname using indexified URLs', () => {
      const contentCatalog = mockContentCatalog({
        family: 'page',
        relative: 'this-page.adoc',
        contents: 'xref:module-a:this-page.adoc#the-fragment[Deep Link to Self]',
        indexify: true,
      }).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'this-page.adoc',
      })
      expectLink(html, '#the-fragment', 'Deep Link to Self')
    })

    it('should use xreftext of target page as content if content not specified', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById')
      const targetPage = contentCatalog.getFiles()[0]
      targetPage.asciidoc = { doctitle: 'Page Title', xreftext: 'reference me' }
      setInputFileContents('xref:module-b:the-topic/the-page.adoc[]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, '../module-b/the-topic/the-page.html', 'reference me')
    })

    it('should use page ID spec of target page as content if content not specified and target has no xreftext', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById')
      setInputFileContents('xref:module-b:the-topic/the-page.adoc[]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, '../module-b/the-topic/the-page.html', 'module-b:the-topic/the-page.adoc')
    })

    it('should use page ID spec as content for page reference with fragment if content not specified', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      }).spyOn('getById')
      const targetPage = contentCatalog.getFiles()[0]
      targetPage.asciidoc = { doctitle: 'Page Title', xreftext: 'page title' }
      setInputFileContents('xref:module-b:the-topic/the-page.adoc#frag[]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-topic/the-page.adoc',
      })
      expectPageLink(html, '../module-b/the-topic/the-page.html#frag', 'module-b:the-topic/the-page.adoc#frag')
    })

    // NOTE: the .adoc file extension is required, however
    it('should not fail to process page reference if fragment attribute is not set', () => {
      const contentCatalog = mockContentCatalog({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'the-page.adoc',
      })
      setInputFileContents('man:the-page[]')
      const extension = function () {
        this.process((parent, target, attrs) =>
          this.createInline(parent, 'anchor', target, {
            type: 'xref',
            target: target + '.adoc',
            attributes: Opal.hash({ refid: target, path: target + '.adoc' }),
          })
        )
      }
      extension.register = (registry) => registry.inlineMacro('man', extension)
      const config = { extensions: [extension] }
      const html = loadAsciiDoc(inputFile, contentCatalog, config).convert()
      expectPageLink(html, 'the-page.html', 'the-page')
    })

    it('should process xref inside of a footnote macro', () => {
      const contentCatalog = mockContentCatalog({
        component: 'relnotes',
        version: '6.5',
        module: 'ROOT',
        family: 'page',
        relative: 'index.adoc',
      })
      ;[
        'xref:6.5@relnotes::index.adoc[completely removed]',
        '<<6.5@relnotes::index.adoc#,completely removed>>',
      ].forEach((pageMacro) => {
        const contents = `Text.footnote:[Support for pixie dust has been ${pageMacro}.]`
        setInputFileContents(contents)
        const doc = loadAsciiDoc(inputFile, contentCatalog)
        const html = doc.convert()
        expect(doc.getCatalog().footnotes).to.have.length(1)
        expectPageLink(html, '../../relnotes/6.5/index.html', 'completely removed')
        expect(html).to.include('>completely removed</a>.')
      })
    })

    it('should allow footnote text to be defined and inserted using attribute', () => {
      const contentCatalog = mockContentCatalog({
        component: 'relnotes',
        version: '6.5',
        module: 'ROOT',
        family: 'page',
        relative: 'index.adoc',
      })
      ;[
        'xref:6.5@relnotes::index.adoc[completely removed]',
        '<<6.5@relnotes::index.adoc#,completely removed>>',
      ].forEach((pageMacro) => {
        const contents = heredoc`
          :fn-text: pass:n[Support for pixie dust has been ${pageMacro}.]

          Text.footnote:pixiedust[{fn-text}]

          More text.footnote:pixiedust[]
        `
        setInputFileContents(contents)
        const doc = loadAsciiDoc(inputFile, contentCatalog)
        const html = doc.convert()
        expect(doc.getCatalog().footnotes).to.have.length(1)
        expectPageLink(html, '../../relnotes/6.5/index.html', 'completely removed')
        expect(html).to.include('<a id="_footnoteref_1" class="footnote" href="#_footnotedef_1"')
        expect(html).to.include('<a class="footnote" href="#_footnotedef_1"')
        expect(html).to.include('>completely removed</a>.')
      })
    })
  })

  describe('image macro', () => {
    it('should pass through unresolved target of block image when specified resource is in same module', () => {
      const contentCatalog = mockContentCatalog(inputFile.src).spyOn('getById')
      setInputFileContents(heredoc`
        = Page Title

        before

        image::no-such-image.png[The Image,250]
      `)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'image',
        relative: 'no-such-image.png',
      })
      expect(html).to.include(' class="imageblock unresolved"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="no-such-image.png')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of image not found: no-such-image.png',
        file: { path: inputFile.src.path, line: 5 },
      })
    })

    it('should pass through unresolved target of block image when specified resource is in different module', () => {
      const contentCatalog = mockContentCatalog(inputFile.src).spyOn('getById')
      setInputFileContents('image::module-b:no-such-image.png[The Image,250]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'no-such-image.png',
      })
      expect(html).to.include(' class="imageblock unresolved"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="module-b:no-such-image.png')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of image not found: module-b:no-such-image.png',
        file: { path: inputFile.src.path },
      })
    })

    it('should pass through target of block image with invalid resource ID', () => {
      const contentCatalog = mockContentCatalog(inputFile.src).spyOn('getById')
      setInputFileContents('image::module-b:image$$[The Image,250]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).to.not.have.been.called()
      expect(html).to.include(' class="imageblock unresolved"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="module-b:image$$')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of image not found: module-b:image$$',
        file: { path: inputFile.src.path },
      })
    })

    it('should skip and log page reference to non-publishable image', () => {
      const contentCatalog = mockContentCatalog({ relative: '_hidden.png', family: 'image' }).spyOn('getById')
      setInputFileContents('image::_hidden.png[Not published]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'image',
        relative: '_hidden.png',
      })
      expect(html).to.include(' class="imageblock unresolved"')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of image not found: _hidden.png',
        file: { path: inputFile.src.path },
      })
    })

    it('should resolve target of block image if it matches resource ID in same module', () => {
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-a', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      setInputFileContents('image::the-image.png[The Image,250]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="_images/the-image.png"')
    })

    it('should resolve target of block image if it matches resource ID in different module', () => {
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      setInputFileContents('image::module-b:the-image.png[The Image,250]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="../module-b/_images/the-image.png"')
    })

    it('should resolve target of block image in topic if resource ID is relative to current page', () => {
      const contentCatalog = mockContentCatalog([
        {
          family: 'page',
          relative: 'the-topic/the-page.adoc',
          contents: 'image::./the-image.png[The Image,250]',
        },
        { family: 'image', relative: 'the-topic/the-image.png' },
      ]).spyOn('getById')
      inputFile = contentCatalog.getFiles()[0]
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'image',
        relative: 'the-topic/the-image.png',
      })
      expect(html).to.include(' class="imageblock"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="../_images/the-topic/the-image.png"')
    })

    it('should allow default converter to handle target of block image if target is a URL', () => {
      const contentCatalog = mockContentCatalog().spyOn('resolveResource')
      const target = 'https://example.org/the-image.png'
      setInputFileContents(`image::${target}[The Image,250]`)
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(html.match(/<img[^>]*>/)[0]).to.include(` src="${target}"`)
      expect(contentCatalog.resolveResource).to.not.have.been.called()
    })

    it('should allow default converter to handle target of block image if target is a data URI', () => {
      const contentCatalog = mockContentCatalog().spyOn('resolveResource')
      const target = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs='
      setInputFileContents(`image::${target}[Dot,16]`)
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(html.match(/<img[^>]*>/)[0]).to.include(` src="${target}"`)
      expect(contentCatalog.resolveResource).to.not.have.been.called()
    })

    it('should pass through unresolved target of inline image when specified resource is in same module', () => {
      const contentCatalog = mockContentCatalog(inputFile.src).spyOn('getById')
      setInputFileContents(heredoc`
        = Page Title

        before

        Generation complete.
        Look for image:no-such-image.png[The Image,16].
      `)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'image',
        relative: 'no-such-image.png',
      })
      expect(html).to.include(' class="image unresolved"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="no-such-image.png')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of image not found: no-such-image.png',
        file: { path: inputFile.src.path, line: 5 },
      })
    })

    it('should pass through unresolved target of inline image when specified resource is in different module', () => {
      const contentCatalog = mockContentCatalog(inputFile.src).spyOn('getById')
      setInputFileContents('Look for image:module-b:no-such-image.png[The Image,16].')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'no-such-image.png',
      })
      expect(html).to.include(' class="image unresolved"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="module-b:no-such-image.png')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of image not found: module-b:no-such-image.png',
        file: { path: inputFile.src.path },
      })
    })

    it('should pass through target of inline image with invalid resource ID', () => {
      const contentCatalog = mockContentCatalog(inputFile.src).spyOn('getById')
      setInputFileContents('Look for image:module-b:image$$[The Image,16]')
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).to.not.have.been.called()
      expect(html).to.include(' class="image unresolved"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="module-b:image$$')
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of image not found: module-b:image$$',
        file: { path: inputFile.src.path },
      })
    })

    it('should resolve target of inline image if it matches resource ID in same module', () => {
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-a', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      setInputFileContents('Look for image:the-image.png[The Image,16].')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="image"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="_images/the-image.png"')
    })

    it('should resolve target of inline image if it matches resource ID in different module', () => {
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      setInputFileContents('Look for image:module-b:the-image.png[The Image,16].')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="image"')
      expect(html.match(/<img[^>]*>/)[0]).to.include(' src="../module-b/_images/the-image.png"')
    })

    it('should allow default converter to handle target of inline image if target is a URL', () => {
      const contentCatalog = mockContentCatalog().spyOn('resolveResource')
      const target = 'https://example.org/the-image.png'
      setInputFileContents(`Look for image:${target}[The Image,16].`)
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(html.match(/<img[^>]*>/)[0]).to.include(` src="${target}"`)
      expect(contentCatalog.resolveResource).to.not.have.been.called()
    })

    it('should allow default converter to handle target of inline image if target is a data URI', () => {
      const contentCatalog = mockContentCatalog().spyOn('resolveResource')
      const target = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs='
      setInputFileContents(`Count each image:${target}[Dot,16].`)
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(html.match(/<img[^>]*>/)[0]).to.include(` src="${target}"`)
      expect(contentCatalog.resolveResource).to.not.have.been.called()
    })

    it('should add link to block image resolved from resource ID if link=self', () => {
      const contents = 'image::module-b:the-image.png[The Image,250,link=self]'
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock"')
      expectImgLink(html, '../module-b/_images/the-image.png', html.match(/<img[^>]*>/)[0])
    })

    it('should add link to block image with remote URL if link=self', () => {
      const contents = 'image::https://upload.wikimedia.org/wikipedia/commons/3/35/Tux.svg[The Tux,250,link=self]'
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).to.not.have.been.called()
      expect(html).to.include(' class="imageblock"')
      expectImgLink(html, 'https://upload.wikimedia.org/wikipedia/commons/3/35/Tux.svg', html.match(/<img[^>]*>/)[0])
    })

    it('should resolve internal anchor referenced by xref attribute on block image macro and link to it', () => {
      const contents = heredoc`
      image::module-b:the-image.png[The Image,250,xref=section-a]

      [#section-a]
      == Section A

      contents
      `
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock"')
      expectImgLink(html, '#section-a', html.match(/<img[^>]*>/)[0])
    })

    it('should resolve internal anchor referenced by xref attribute with leading # on block image macro and link to it', () => {
      const contents = heredoc`
      image::module-b:the-image.png[The Image,250,xref=#section-a]

      [#section-a]
      == Section A

      contents
      `
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock"')
      expectImgLink(html, '#section-a', html.match(/<img[^>]*>/)[0])
    })

    it('should pass through unresolved xref on block image macro as href of enclosing link', () => {
      const contentCatalog = mockContentCatalog({
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      }).spyOn('getById')
      setInputFileContents(heredoc`
        = Page Title
        :role: ignored

        before

        then some

        image::module-b:the-image.png[The Image,250,xref=module-b:no-such-page.adoc]
      `)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'no-such-page.adoc',
      })
      expect(contentCatalog.getById).nth(0).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock xref-unresolved"')
      expectImgLink(html, '#module-b:no-such-page.adoc', html.match(/<img[^>]*>/)[0])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref on image not found: module-b:no-such-page.adoc',
        file: { path: inputFile.src.path, line: 8 },
      })
    })

    it('should resolve page referenced by xref attribute on block image macro and link to it', () => {
      const contentCatalog = mockContentCatalog([
        { module: 'module-b', family: 'page', relative: 'the-page.adoc' },
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      setInputFileContents('image::module-b:the-image.png[The Image,250,role=border,xref=module-b:the-page.adoc]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock xref-page border"')
      expectImgLink(html, '../module-b/the-page.html', html.match(/<img[^>]*>/)[0])
    })

    it('should resolve non-page referenced by xref attribute on block image macro and link to it', () => {
      const contentCatalog = mockContentCatalog([
        { module: 'module-b', family: 'attachment', relative: 'the-attachment.zip' },
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      setInputFileContents('image::module-b:the-image.png[The Image,250,xref=module-b:attachment$the-attachment.zip]')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'attachment',
        relative: 'the-attachment.zip',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock xref-attachment"')
      expectImgLink(html, '../module-b/_attachments/the-attachment.zip', html.match(/<img[^>]*>/)[0])
    })

    it('should resolve anchor referenced by xref attribute on inline image macro and link to it', () => {
      const contents = heredoc`
      Look for image:module-b:the-image.png[The Image,16,xref=section-a].

      [#section-a]
      == Section A
      `
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="image"')
      expectImgLink(html, '#section-a', html.match(/<img[^>]*>/)[0])
    })

    it('should resolve page with fragment referenced by xref attribute on block image macro and link to it', () => {
      const contentCatalog = mockContentCatalog([
        { module: 'module-b', family: 'page', relative: 'the-page.adoc' },
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      setInputFileContents(
        'image::module-b:the-image.png[The Image,250,role=border,xref=module-b:the-page.adoc#anchor]'
      )
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock xref-page border"')
      expectImgLink(html, '../module-b/the-page.html#anchor', html.match(/<img[^>]*>/)[0])
    })

    it('should ignore xref attribute on block image if link attribute is set', () => {
      const contents = 'image::module-b:the-image.png[The Image,link=https://example.org,xref=module-b:the-page.adoc]'
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'page', relative: 'the-page.adoc' },
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).to.have.been.called.once()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="imageblock"')
      expectImgLink(html, 'https://example.org', html.match(/<img[^>]*>/)[0])
    })

    it('should pass through unresolved xref on inline image macro as href of enclosing link', () => {
      const contentCatalog = mockContentCatalog({
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      }).spyOn('getById')
      setInputFileContents(heredoc`
        = Page Title

        Generation complete.
        Look for image:module-b:the-image.png[The Image,16,xref=module-b:no-such-page.adoc].
      `)
      const { messages, returnValue: html } = captureLogSync(() =>
        loadAsciiDoc(inputFile, contentCatalog, { sourcemap: true }).convert()
      ).withReturnValue()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'no-such-page.adoc',
      })
      expect(contentCatalog.getById).nth(0).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="image xref-unresolved"')
      expectImgLink(html, '#module-b:no-such-page.adoc', html.match(/<img[^>]*>/)[0])
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: 'target of xref on image not found: module-b:no-such-page.adoc',
        file: { path: inputFile.src.path, line: 3 },
      })
    })

    it('should add link to inline image resolved from resource ID if link=self', () => {
      const contents = 'image:module-b:the-image.png[The Image,250,link=self]'
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include('span class="image"')
      expectImgLink(html, '../module-b/_images/the-image.png', html.match(/<img[^>]*>/)[0])
    })

    it('should add link to inline image with remote URL if link=self', () => {
      const contents = 'image:https://upload.wikimedia.org/wikipedia/commons/3/35/Tux.svg[The Tux,250,link=self]'
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog().spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).to.not.have.been.called()
      expect(html).to.include('span class="image"')
      expectImgLink(html, 'https://upload.wikimedia.org/wikipedia/commons/3/35/Tux.svg', html.match(/<img[^>]*>/)[0])
    })

    it('should resolve page referenced by xref attribute on inline image macro and link to it', () => {
      const contentCatalog = mockContentCatalog([
        { module: 'module-b', family: 'page', relative: 'the-page.adoc' },
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      setInputFileContents('Look for image:module-b:the-image.png[The Image,16,role=icon,xref=module-b:the-page.adoc].')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'page',
        relative: 'the-page.adoc',
      })
      expect(contentCatalog.getById).nth(2).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="image xref-page icon"')
      expectImgLink(html, '../module-b/the-page.html', html.match(/<img[^>]*>/)[0])
    })

    it('should ignore xref attribute on inline image if link attribute is set', () => {
      const contents = 'image:module-b:the-image.png[The Image,link=https://example.org,xref=module-b:the-page.adoc]'
      setInputFileContents(contents)
      const contentCatalog = mockContentCatalog([
        inputFile.src,
        { module: 'module-b', family: 'page', relative: 'the-page.adoc' },
        { module: 'module-b', family: 'image', relative: 'the-image.png' },
      ]).spyOn('getById')
      const html = loadAsciiDoc(inputFile, contentCatalog).convert()
      expect(contentCatalog.getById).to.have.been.called.once()
      expect(contentCatalog.getById).nth(1).called.with({
        component: 'component-a',
        version: '',
        module: 'module-b',
        family: 'image',
        relative: 'the-image.png',
      })
      expect(html).to.include(' class="image"')
      expectImgLink(html, 'https://example.org', html.match(/<img[^>]*>/)[0])
    })
  })
})

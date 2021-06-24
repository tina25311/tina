/* eslint-env mocha */
'use strict'

const { captureStdoutLog, expect, rmdirSync, toJSON } = require('../../../test/test-utils')

const cheerio = require('cheerio')
const fs = require('fs')
const generateSite = require('@antora/site-generator-default')
const GitServer = require('node-git-server')
const { once } = require('events')
const ospath = require('path')
const RepositoryBuilder = require('../../../test/repository-builder')

const CONTENT_REPOS_DIR = ospath.join(__dirname, 'content-repos')
const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')
const WORK_DIR = ospath.join(__dirname, 'work')
const UI_BUNDLE_URI =
  'https://gitlab.com/antora/antora-ui-default/-/jobs/artifacts/master/raw/build/ui-bundle.zip?job=bundle-stable'

describe('generateSite()', function () {
  let $
  let absDestDir
  let destDir
  let env
  let playbookSpec
  let playbookFile
  let repoBuilder
  let uiBundleUri
  let gitServer

  const timeoutOverride = this.timeout() * 2

  const readFile = (file, dir) => fs.readFileSync(dir ? ospath.join(dir, file) : file, 'utf8')

  const loadHtmlFile = (relative) => cheerio.load(readFile(relative, absDestDir))

  before(async () => {
    destDir = '_site'
    absDestDir = ospath.join(WORK_DIR, destDir)
    playbookFile = ospath.join(WORK_DIR, 'the-site.json')
    gitServer = new GitServer(CONTENT_REPOS_DIR, { autoCreate: false })
    const gitServerPort = await new Promise((resolve, reject) =>
      gitServer.listen(0, function (err) {
        err ? reject(err) : resolve(this.address().port)
      })
    )
    repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
    uiBundleUri = UI_BUNDLE_URI
  })

  beforeEach(async () => {
    env = { ANTORA_CACHE_DIR: ospath.join(WORK_DIR, '.antora/cache') }
    rmdirSync(CONTENT_REPOS_DIR)
    fs.mkdirSync(WORK_DIR, { recursive: true })
    try {
      fs.unlinkSync(playbookFile)
    } catch (ioe) {
      if (ioe.code !== 'ENOENT') throw ioe
    }
    rmdirSync(ospath.join(WORK_DIR, destDir.split('/')[0]))
    rmdirSync(ospath.join(env.ANTORA_CACHE_DIR, 'content'))
    await repoBuilder
      .init('the-component')
      .then(() => repoBuilder.checkoutBranch('v2.0'))
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-component',
          version: '2.0',
          nav: ['modules/ROOT/nav.adoc'],
        })
      )
      .then(() => repoBuilder.importFilesFromFixture('the-component'))
      .then(() => repoBuilder.close('master'))
    playbookSpec = {
      runtime: { quiet: true },
      site: { title: 'The Site' },
      content: {
        sources: [{ url: repoBuilder.repoPath, branches: 'v2.0' }],
      },
      ui: {
        bundle: { url: uiBundleUri, snapshot: true },
      },
      output: {
        destinations: [{ provider: 'fs', path: '.' + ospath.sep + destDir }],
      },
    }
  })

  after(async () => {
    await once(gitServer.server.close(), 'close')
    rmdirSync(CONTENT_REPOS_DIR)
    if (process.env.KEEP_CACHE) {
      rmdirSync(ospath.join(WORK_DIR, destDir.split('/')[0]))
      fs.unlinkSync(playbookFile)
    } else {
      rmdirSync(WORK_DIR)
    }
  })

  it('should generate site into output directory specified in playbook file', async () => {
    playbookSpec.site.start_page = '2.0@the-component::index.adoc'
    playbookSpec.site.keys = { google_analytics: 'UA-XXXXXXXX-1' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, '_'))
      .to.be.a.directory()
      .with.subDirs.with.members(['css', 'js', 'font', 'img'])
    const absCssDir = ospath.join(absDestDir, '_', 'css')
    expect(ospath.join(absDestDir, '_/css/site.css')).to.be.a.file()
    expect(absCssDir)
      .to.be.a.directory()
      .with.files.that.satisfy((files) =>
        files.every((file) => fs.statSync(ospath.join(absCssDir, file)).mode === 33206)
      )
    expect(ospath.join(absDestDir, '_/js/site.js')).to.be.a.file()
    expect(ospath.join(absDestDir, '404.html')).to.not.be.a.path()
    expect(ospath.join(absDestDir, 'the-component'))
      .to.be.a.directory()
      .with.subDirs(['2.0'])
    expect(ospath.join(absDestDir, 'index.html'))
      .to.be.a.file()
      .with.contents.that.match(/<meta http-equiv="refresh" content="0; url=the-component\/2.0\/index.html">/)
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('head > title')).to.have.text('Index Page :: The Site')
    // assert relative UI path is correct
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '../../_/css/site.css')
    expect($('head > script:first-of-type')).to.have.attr(
      'src',
      'https://www.googletagmanager.com/gtag/js?id=UA-XXXXXXXX-1'
    )
    expect($('body > script:first-of-type')).to.have.attr('src', '../../_/js/site.js')
    expect($('nav.navbar .navbar-brand .navbar-item')).to.have.attr('href', '../..')
    // assert current component version is correct
    expect($('.nav-panel-explore .context .title')).to.have.text('The Component')
    expect($('.nav-panel-explore .component.is-current .title')).to.have.text('The Component')
    expect($('.nav-panel-explore .component.is-current .version')).to.have.lengthOf(1)
    expect($('.nav-panel-explore .component.is-current .version a')).to.have.text('2.0')
    expect($('.nav-panel-explore .component.is-current .version.is-current a')).to.have.text('2.0')
    expect($('.nav-panel-explore .component.is-current .version.is-latest a')).to.have.text('2.0')
    // assert paths in navigation are relativized
    expect($('nav.nav-menu .nav-link')).to.have.attr('href', 'index.html')
    expect($('article h1')).to.have.text('Index Page')
    expect($('article img')).to.have.attr('src', '_images/activity-diagram.svg')
    expect(ospath.join(absDestDir, 'the-component/2.0/_images')).to.be.a.directory()
    expect(ospath.join(absDestDir, 'the-component/2.0/_images/activity-diagram.svg')).to.be.a.file()
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('nav.nav-menu .is-current-page')).to.have.lengthOf(1)
    expect($('nav.nav-menu .is-current-page > a.nav-link')).to.have.attr('href', 'the-page.html')
    expect($('.page-versions')).to.not.exist()
  }).timeout(timeoutOverride)

  it('should resolve dot-relative paths in playbook relative to playbook dir', async () => {
    const repoUrl = '.' + ospath.sep + ospath.relative(WORK_DIR, playbookSpec.content.sources[0].url)
    playbookSpec.content.sources[0].url = repoUrl
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const altWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
    fs.mkdirSync(altWorkDir, { recursive: true })
    const cwd = process.cwd()
    process.chdir(altWorkDir)
    await generateSite(['--playbook', ospath.relative('.', playbookFile)], env)
    process.chdir(cwd)
    expect(ospath.join(absDestDir, '_'))
      .to.be.a.directory()
      .with.subDirs.with.members(['css', 'js', 'font', 'img'])
    expect(ospath.join(absDestDir, 'the-component'))
      .to.be.a.directory()
      .with.subDirs(['2.0'])
  }).timeout(timeoutOverride)

  it('should generate site into output directory specified in arguments', async () => {
    const destDirOverride = ospath.join(destDir, 'beta')
    const absDestDirOverride = ospath.join(WORK_DIR, destDirOverride)
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile, '--to-dir', '.' + ospath.sep + destDirOverride], env)
    expect(ospath.join(absDestDirOverride, '_'))
      .to.be.a.directory()
      .with.subDirs.with.members(['css', 'js', 'font', 'img'])
    expect(ospath.join(absDestDirOverride, 'the-component'))
      .to.be.a.directory()
      .with.subDirs(['2.0'])
  }).timeout(timeoutOverride)

  it('should use start page from latest version of component if version not specified', async () => {
    playbookSpec.site.start_page = 'the-component::index.adoc'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'index.html'))
      .to.be.a.file()
      .with.contents.that.match(/<meta http-equiv="refresh" content="0; url=the-component\/2.0\/index.html">/)
  }).timeout(timeoutOverride)

  it('should log warning message if site start page is missing .adoc file extension', async () => {
    playbookSpec.site.start_page = 'the-component::index'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = await captureStdoutLog(() => generateSite(['--playbook', playbookFile], env))
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.include({
      level: 'warn',
      name: '@antora/content-classifier',
      msg: 'Start page specified for site not found: the-component::index',
    })
  }).timeout(timeoutOverride)

  it('should log warning message if site start page cannot be resolved', async () => {
    playbookSpec.site.start_page = 'unknown-component::index.adoc'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = await captureStdoutLog(() => generateSite(['--playbook', playbookFile], env))
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.include({
      level: 'warn',
      name: '@antora/content-classifier',
      msg: 'Start page specified for site not found: unknown-component::index.adoc',
    })
  }).timeout(timeoutOverride)

  it('should log warning message if component version start page cannot be resolved and use index page instead', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v2.0'))
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-component',
          version: '2.0',
          start_page: 'unknown-page.adoc',
          nav: ['modules/ROOT/nav.adoc'],
        })
      )
      .then(() => repoBuilder.commitAll())
      .then(() => repoBuilder.close('master'))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = await captureStdoutLog(() => generateSite(['--playbook', playbookFile], env))
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.include({
      level: 'warn',
      name: '@antora/content-classifier',
      msg: 'Start page specified for 2.0@the-component not found: unknown-page.adoc',
    })
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('.nav-panel-explore .component.is-current .versions a').eq(0)).to.have.attr('href', 'index.html')
  }).timeout(timeoutOverride)

  it('should log error message if xref cannot be resolved', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v2.0'))
      .then(() => repoBuilder.removeFromWorktree('modules/ROOT/pages/new-page.adoc'))
      .then(() => repoBuilder.commitAll())
      .then(() => repoBuilder.close('master'))
    playbookSpec.content.sources[0].url = repoBuilder.url
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = await captureStdoutLog(() => generateSite(['--playbook', playbookFile], env))
    expect(messages).to.have.lengthOf(2)
    ;['the-freshness.adoc', '2.0@the-freshness.adoc'].forEach((refSpec, idx) => {
      expect(messages[idx]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: `target of xref not found: ${refSpec}`,
        file: { path: 'modules/ROOT/pages/index.adoc' },
        source: { refname: 'v2.0', url: repoBuilder.url },
      })
    })
  }).timeout(timeoutOverride)

  it('should qualify applicable links using site url if set in playbook', async () => {
    playbookSpec.site.url = 'https://example.com/docs/'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'sitemap.xml')).to.be.a.file()
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html'))
      .to.be.a.file()
      .not.with.contents.that.match(/the-component\/2\.0\/_attributes\.html/)
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('head link[rel=canonical]')).to.have.attr('href', 'https://example.com/docs/the-component/2.0/index.html')
    expect($('nav.navbar .navbar-brand .navbar-item')).to.have.attr('href', 'https://example.com/docs')
  }).timeout(timeoutOverride)

  it('should generate 404 page if site url is set to absolute URL in playbook', async () => {
    playbookSpec.site.url = 'https://example.com'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('Page Not Found :: The Site')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '/_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', '/_/js/site.js')
    expect($('.navbar-brand a.navbar-item')).to.have.attr('href', 'https://example.com')
    expect($('.nav-panel-explore .version.is-latest a')).to.have.attr('href', '/the-component/2.0/index.html')
  }).timeout(timeoutOverride)

  it('should generate 404 page if site url is set to absolute URL with subpath in playbook', async () => {
    playbookSpec.site.url = 'https://example.com/docs'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('Page Not Found :: The Site')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '/docs/_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', '/docs/_/js/site.js')
    expect($('.navbar-brand a.navbar-item')).to.have.attr('href', 'https://example.com/docs')
    expect($('.nav-panel-explore .version.is-latest a')).to.have.attr('href', '/docs/the-component/2.0/index.html')
  }).timeout(timeoutOverride)

  it('should generate 404 page if site url is set to / in playbook', async () => {
    playbookSpec.site.url = '/'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('Page Not Found :: The Site')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '/_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', '/_/js/site.js')
    expect($('.navbar-brand a.navbar-item')).to.have.attr('href', '/')
    expect($('.nav-panel-explore .version.is-latest a')).to.have.attr('href', '/the-component/2.0/index.html')
  }).timeout(timeoutOverride)

  it('should generate 404 page if site url is set to a pathname in the playbook', async () => {
    playbookSpec.site.url = '/docs'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('Page Not Found :: The Site')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '/docs/_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', '/docs/_/js/site.js')
    expect($('.navbar-brand a.navbar-item')).to.have.attr('href', '/docs')
    expect($('.nav-panel-explore .version.is-latest a')).to.have.attr('href', '/docs/the-component/2.0/index.html')
  }).timeout(timeoutOverride)

  it('should be able to reference implicit page attributes', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('article').text()).to.include('This is version 2.0 of component the-component.')
  }).timeout(timeoutOverride)

  it('should pass AsciiDoc attributes defined in playbook to AsciiDoc processor', async () => {
    playbookSpec.asciidoc = {
      attributes: { sectanchors: null, sectnums: '', description: 'Stuff about stuff@' },
    }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('head meta[name=description]')).to.have.attr('content', 'Stuff about stuff')
    expect($('h2#_section_a')).to.have.html('1. Section A')
    expect($('h2#_section_b')).to.have.html('2. Section B')
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('head meta[name=description]')).to.have.attr('content', 'The almighty index page')
  }).timeout(timeoutOverride)

  it('should pass AsciiDoc attributes defined in component descriptor to AsciiDoc processor', async () => {
    playbookSpec.asciidoc = {
      attributes: { sectanchors: null, description: 'Site description@' },
    }
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v2.0'))
      .then(() =>
        repoBuilder.addComponentDescriptor({
          name: 'the-component',
          version: '2.0',
          nav: ['modules/ROOT/nav.adoc'],
          asciidoc: {
            attributes: { description: 'Component description@', sectnums: '' },
          },
        })
      )
      .then(() => repoBuilder.close('master'))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('head meta[name=description]')).to.have.attr('content', 'Component description')
    expect($('h2#_section_a')).to.have.html('1. Section A')
    expect($('h2#_section_b')).to.have.html('2. Section B')
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('head meta[name=description]')).to.have.attr('content', 'The almighty index page')
  }).timeout(timeoutOverride)

  it('should register extensions defined in playbook on AsciiDoc processor', async () => {
    const absExtensionPath = ospath.resolve(WORK_DIR, 'ext', 'shout-tree-processor.js')
    fs.mkdirSync(ospath.dirname(absExtensionPath), { recursive: true })
    fs.copyFileSync(ospath.resolve(FIXTURES_DIR, 'shout-tree-processor.js'), absExtensionPath)
    playbookSpec.asciidoc = {
      attributes: { volume: '3' },
      extensions: ['./ext/shout-tree-processor.js', ospath.resolve(FIXTURES_DIR, 'named-entity-postprocessor.js')],
    }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html'))
      .to.be.a.file()
      .with.contents.that.match(/Section A content!!!/)
      .and.with.contents.that.match(/&#169;/)
    global.Opal.Asciidoctor.Extensions.unregisterAll()
  }).timeout(timeoutOverride)

  it('should be able to reference environment variable from UI template added as supplemental file', async () => {
    env.SITE_NAME = 'Learn All The Things!'
    playbookSpec.ui.supplemental_files = [
      {
        path: 'partials/head-meta.hbs',
        contents: '<meta property="og:site_name" content="{{env.SITE_NAME}}">',
      },
    ]
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html'))
      .to.be.a.file()
      .with.contents.that.match(/<meta property="og:site_name" content="Learn All The Things!">/)
  }).timeout(timeoutOverride)

  it('should output UI to directory defined in playbook even if defined in UI bundle', async () => {
    playbookSpec.ui.output_dir = 'ui'
    playbookSpec.ui.supplemental_files = [
      {
        path: 'ui.yml',
        contents: 'output_dir: not-used',
      },
    ]
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'ui'))
      .to.be.a.directory()
      .with.subDirs.with.members(['css', 'js', 'font', 'img'])
  }).timeout(timeoutOverride)

  it('should add edit page link to toolbar that links to edit URL if page.editUrl is set in UI model', async () => {
    const remoteGitUrl = 'git@gitlab.com:org/docs-repo.git'
    const remoteWebUrl = 'https://gitlab.com/org/docs-repo'
    const refname = 'v2.0'
    await repoBuilder
      .open()
      .then(() => repoBuilder.config('remote.origin.url', remoteGitUrl))
      .then(() => repoBuilder.close())
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl = `${remoteWebUrl}/edit/${refname}/${thePagePath}`
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  }).timeout(timeoutOverride)

  it('should add edit page link to toolbar that links to custom edit URL', async () => {
    const editBaseUrl = repoBuilder.url.replace(/\.git$/, '')
    const refname = 'v2.0'
    playbookSpec.content.sources[0].url = repoBuilder.url
    playbookSpec.content.sources[0].editUrl = `${editBaseUrl}/edit/{refname}/{path}`
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl = `${editBaseUrl}/edit/${refname}/${thePagePath}`
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  }).timeout(timeoutOverride)

  it('should not add edit page link to toolbar if repository is private', async () => {
    playbookSpec.content.sources[0].url = repoBuilder.url.replace('//', '//@')
    playbookSpec.content.sources[0].editUrl = `${repoBuilder.url.replace(/\.git$/, '')}/edit/{refname}/{path}`
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('.toolbar .edit-this-page')).to.not.exist()
  }).timeout(timeoutOverride)

  it('should add edit page link to toolbar for private repository if env.FORCE_SHOW_EDIT_PAGE_LINK=true', async () => {
    const editBaseUrl = repoBuilder.url.replace(/\.git$/, '')
    const refname = 'v2.0'
    playbookSpec.content.sources[0].url = repoBuilder.url.replace('//', '//@')
    playbookSpec.content.sources[0].editUrl = `${editBaseUrl}/edit/{refname}/{path}`
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    env.FORCE_SHOW_EDIT_PAGE_LINK = 'true'
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl = `${editBaseUrl}/edit/${refname}/${thePagePath}`
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  }).timeout(timeoutOverride)

  it('should add edit page link to toolbar that links to local file if page.fileUri is set in UI model', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v2.0'))
      .then(() => repoBuilder.close())
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    expect(env).to.not.have.property('CI')
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl =
      ospath.sep === '\\'
        ? 'file:///' + ospath.join(repoBuilder.repoPath, thePagePath).replace(/\\/g, '/')
        : 'file://' + ospath.join(repoBuilder.repoPath, thePagePath)
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  }).timeout(timeoutOverride)

  it('should point edit page link to edit URL instead of local file if CI env var is set', async () => {
    env.CI = 'true'
    const remoteGitUrl = 'git@gitlab.com:org/docs-repo.git'
    const remoteWebUrl = 'https://gitlab.com/org/docs-repo'
    const refname = 'v2.0'
    await repoBuilder
      .open()
      .then(() => repoBuilder.config('remote.origin.url', remoteGitUrl))
      .then(() => repoBuilder.checkoutBranch(refname))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl = `${remoteWebUrl}/edit/${refname}/${thePagePath}`
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  }).timeout(timeoutOverride)

  it('should provide navigation to multiple versions of a component', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v1.0'))
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-component',
          version: '1.0',
          nav: ['modules/ROOT/nav.adoc'],
        })
      )
      .then(() =>
        repoBuilder.importFilesFromFixture('the-component', {
          exclude: ['modules/ROOT/pages/new-page.adoc'],
        })
      )
      .then(() => repoBuilder.close('master'))
    playbookSpec.content.sources[0].branches = ['v2.0', 'v1.0']
    playbookSpec.runtime.log = { level: 'silent' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component'))
      .to.be.a.directory()
      .with.subDirs(['1.0', '2.0'])
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    // assert that all versions of page are shown
    expect($('.page-versions')).to.exist()
    expect($('.page-versions .version-menu-toggle')).to.have.text('2.0')
    expect($('.page-versions a.version')).to.have.lengthOf(2)
    expect($('.page-versions a.version.is-current'))
      .to.have.lengthOf(1)
      .and.to.have.text('2.0')
      .and.to.have.attr('href', 'the-page.html')
    expect($('.page-versions a.version:not(.is-current)'))
      .to.have.lengthOf(1)
      .and.to.have.text('1.0')
      .and.to.have.attr('href', '../1.0/the-page.html')
    expect(ospath.join(absDestDir, 'the-component/1.0/new-page.html')).to.not.be.a.path()
    expect(ospath.join(absDestDir, 'the-component/2.0/new-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/new-page.html')
    expect($('.page-versions a.version')).to.have.lengthOf(2)
    expect($('.page-versions a.version:not(.is-current)'))
      .to.have.lengthOf(1)
      .and.to.have.class('is-missing')
      .and.to.have.text('1.0')
      .and.to.have.attr('href', '../1.0/index.html')
    // assert that all versions of component are present in navigation explore panel
    expect($('.nav-panel-explore .component.is-current li.version')).to.have.lengthOf(2)
    expect(
      $('.nav-panel-explore .component.is-current li.version')
        .eq(0)
        .find('a')
    )
      .to.have.text('2.0')
      .and.to.have.attr('href', 'index.html')
    expect(
      $('.nav-panel-explore .component.is-current li.version')
        .eq(1)
        .find('a')
    )
      .to.have.text('1.0')
      .and.to.have.attr('href', '../1.0/index.html')
    expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/1.0/the-page.html')
    expect($('.nav-panel-explore .component.is-current .version')).to.have.lengthOf(2)
    expect($('.nav-panel-explore .component.is-current .version.is-latest a')).to.have.text('2.0')
    expect($('.nav-panel-explore .component.is-current .version.is-current a')).to.have.text('1.0')
  }).timeout(timeoutOverride)

  it('should provide navigation to all versions of all components', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v1.0'))
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-component',
          version: '1.0',
          nav: ['modules/ROOT/nav.adoc'],
        })
      )
      .then(() =>
        repoBuilder.importFilesFromFixture('the-component', {
          exclude: ['modules/ROOT/pages/new-page.adoc'],
        })
      )
      .then(() => repoBuilder.close('master'))
    await repoBuilder
      .init('the-other-component')
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-other-component',
          version: 'master',
          start_page: 'core:index.adoc',
          nav: ['modules/core/nav.adoc'],
        })
      )
      .then(() => repoBuilder.importFilesFromFixture('the-other-component'))
      .then(() => repoBuilder.checkoutBranch('v1.0'))
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-other-component',
          version: '1.0',
          start_page: 'core:index.adoc',
          nav: ['modules/core/nav.adoc'],
        })
      )
      .then(() => repoBuilder.commitAll('add component descriptor for 1.0'))
      .then(() => repoBuilder.close('master'))

    playbookSpec.content.sources[0].branches = ['v2.0', 'v1.0']
    playbookSpec.content.sources.push({
      url: repoBuilder.repoPath,
      branches: ['master', 'v1.0'],
    })
    playbookSpec.runtime.log = { level: 'silent' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-other-component')).to.be.a.directory()
    expect(ospath.join(absDestDir, 'the-other-component/core/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-other-component/core/index.html')
    expect($('.nav-panel-explore .component')).to.have.lengthOf(2)
    // assert sorted by title
    expect(
      $('.nav-panel-explore .component')
        .eq(0)
        .find('.title')
    ).to.have.text('The Component')
    expect(
      $('.nav-panel-explore .component')
        .eq(1)
        .find('.title')
    ).to.have.text('The Other Component')
    // assert correct component is marked as current
    expect($('.nav-panel-explore .component').eq(1)).to.have.class('is-current')
    expect($('.nav-panel-explore .component.is-current a')).to.have.lengthOf(3)
    expect($('.nav-panel-explore .component.is-current a.title')).to.have.lengthOf(1)
    expect($('.nav-panel-explore .component.is-current .versions a')).to.have.lengthOf(2)
    expect($('.nav-panel-explore .component.is-current .versions a').eq(0)).to.have.text('master')
    expect($('.nav-panel-explore .component.is-current .version').eq(0))
      .to.have.class('is-current')
      .and.to.have.class('is-latest')
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/index.html')
    // assert component link points to start page
    expect($('.nav-panel-explore .component:not(.is-current) a.title')).to.have.attr(
      'href',
      '../../the-other-component/core/index.html'
    )
    expect($('.nav-panel-explore .component:not(.is-current) .versions a').eq(0)).to.have.attr(
      'href',
      '../../the-other-component/core/index.html'
    )
  }).timeout(timeoutOverride)

  it('should resolve xrefs that use an alias as the target', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    const contents = readFile('the-component/2.0/index.html', absDestDir)
    expect(contents).to.include('<a href="the-page.html" class="page">its alias</a>')
    expect(contents).to.include('<a href="new-page.html" class="page">the new page</a>')
    expect(contents).to.include('<a href="new-page.html" class="page">2.0</a>')
  }).timeout(timeoutOverride)

  // NOTE this also tests that aliases do not have to have the .adoc file extension
  it('should generate static redirect files for aliases by default', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-alias.html')).to.be.a.file()
    let contents = readFile('the-component/2.0/the-alias.html', absDestDir)
    expect(contents).to.include('<script>location="the-page.html"</script>')
    contents = readFile('the-component/2.0/the-freshness.html', absDestDir)
    expect(contents).to.include('<script>location="new-page.html"</script>')
  }).timeout(timeoutOverride)

  // NOTE this also tests that aliases do not have to have the .adoc file extension
  it('should generate nginx rewrite config file for aliases when using nginx redirect facility', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile, '--redirect-facility', 'nginx'], env)
    expect(ospath.join(absDestDir, '.etc/nginx/rewrite.conf')).to.be.a.file()
    const contents = readFile('.etc/nginx/rewrite.conf', absDestDir)
    const rule2 = 'location = /the-component/2.0/the-freshness.html { return 301 /the-component/2.0/new-page.html; }'
    const rule1 = 'location = /the-component/2.0/the-alias.html { return 301 /the-component/2.0/the-page.html; }'
    expect(contents).to.include(rule1)
    expect(contents).to.include(rule2)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-alias.html')).to.not.be.a.path()
    expect(ospath.join(absDestDir, 'the-component/2.0/the-freshness.html')).to.not.be.a.path()
  }).timeout(timeoutOverride)

  it('should indexify URLs to internal pages', async () => {
    playbookSpec.urls = { html_extension_style: 'indexify' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.be.a.file()
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('article a.page')).to.have.attr('href', 'the-page/')
    expect($('nav.breadcrumbs a')).to.have.attr('href', './')
    expect($('nav.nav-menu .nav-link')).to.have.attr('href', './')
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page/index.html')
    expect($('nav.nav-menu .nav-link')).to.have.attr('href', '../')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '../../../_/css/site.css')
    expect(ospath.join(absDestDir, 'the-component/2.0/the-alias/index.html')).to.be.a.file()
    const contents = readFile('the-component/2.0/the-alias/index.html', absDestDir)
    expect(contents).to.include('<script>location="../the-page/"</script>')
  }).timeout(timeoutOverride)

  describe('integration', () => {
    beforeEach(() => {
      rmdirSync(ospath.join(env.ANTORA_CACHE_DIR, 'content'))
    })

    it('should output archive from site generated from git repository', async () => {
      const archivePath = ['.', destDir, 'site.zip'].join(ospath.sep)
      const absArchivePath = ospath.join(WORK_DIR, archivePath)
      playbookSpec.content.sources[0].url = repoBuilder.url
      playbookSpec.output.destinations[0] = { provider: 'archive', path: archivePath }
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      await generateSite(['--playbook', playbookFile], env)
      expect(absArchivePath).to.be.a.file()
    }).timeout(timeoutOverride)

    // NOTE we can't test this in the cli tests since child_process.spawn does not allocate a tty
    it('should report progress of repository clone and fetch operations if runtime.quiet is false', async () => {
      playbookSpec.runtime.quiet = false
      playbookSpec.content.sources[0].url = repoBuilder.url
      playbookSpec.output.destinations = []
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const defaultStdout = 'clearLine columns cursorTo isTTY moveCursor write'.split(' ').reduce((accum, name) => {
        accum[name] = process.stdout[name]
        return accum
      }, {})
      const columns = 9 + repoBuilder.url.length * 2
      const progressLines = []
      try {
        Object.assign(process.stdout, {
          clearLine: () => {},
          columns,
          cursorTo: () => {},
          isTTY: true,
          moveCursor: () => {},
          write: (line) => /\[(?:clone|fetch)\]/.test(line) && progressLines.push(line),
        })
        await generateSite(['--playbook', playbookFile], env)
        expect(progressLines).to.have.lengthOf.at.least(2)
        expect(progressLines[0]).to.include('[clone] ' + repoBuilder.url)
        expect(progressLines[0]).to.match(/ \[-+\]/)
        expect(progressLines[progressLines.length - 1]).to.match(/ \[#+\]/)

        progressLines.length = 0
        await generateSite(['--playbook', playbookFile], env)
        expect(progressLines).to.have.lengthOf(0)

        // TODO assert that the UI was downloaded again
        await generateSite(['--playbook', playbookFile, '--fetch'], env)
        expect(progressLines).to.have.lengthOf.at.least(2)
        expect(progressLines[0]).to.include('[fetch] ' + repoBuilder.url)
        expect(progressLines[0]).to.match(/ \[-+\]/)
        expect(progressLines[progressLines.length - 1]).to.match(/ \[#+\]/)
      } finally {
        Object.assign(process.stdout, defaultStdout)
      }
    }).timeout(timeoutOverride)

    // NOTE we can't test this in the cli tests since child_process.spawn does not allocate a tty
    it('should report completion message if runtime.quiet is false', async () => {
      playbookSpec.runtime.quiet = false
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const defaultStdout = 'clearLine columns cursorTo isTTY moveCursor write'.split(' ').reduce((accum, name) => {
        accum[name] = process.stdout[name]
        return accum
      }, {})
      const columns = 9 + repoBuilder.url.length * 2
      const messages = []
      try {
        Object.assign(process.stdout, {
          clearLine: () => {},
          columns,
          cursorTo: () => {},
          isTTY: true,
          moveCursor: () => {},
          write: (line) => messages.push(line),
        })
        await generateSite(['--playbook', playbookFile], env)
        expect(messages).to.have.lengthOf(2)
        expect(messages[0]).to.equal('Site generation complete!\n')
        const expectedFileUri = `file://${ospath.sep === '\\' ? '/' + absDestDir.replace(/\\/g, '/') : absDestDir}`
        expect(messages[1]).to.equal(`View the site by visiting ${expectedFileUri} in a browser.\n`)
      } finally {
        Object.assign(process.stdout, defaultStdout)
      }
    }).timeout(timeoutOverride)
  })

  // to test:
  // - don't pass environment variable map to generateSite
  // - pass environment variable override to generateSite
  // - path to images from topic dir
  // - html URL extension style
  // - ui.yml is not published
})

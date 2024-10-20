/* eslint-env mocha */
'use strict'

const {
  captureStdout,
  captureStderr,
  captureStdoutLog,
  closeServer,
  expect,
  GitServer,
  heredoc,
  loadHtml,
  pathToFileURL,
  RepositoryBuilder,
  toJSON,
  trapAsyncError,
  wipeSync,
} = require('@antora/test-harness')

const { configureLogger, getLogger } = require('@antora/logger')
const fs = require('fs')
const generateSite = require('@antora/site-generator')
const buildPlaybook = require('@antora/playbook-builder')
const ospath = require('path')

const CONTENT_REPOS_DIR = ospath.join(__dirname, 'content-repos')
const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')
const WORK_DIR = ospath.join(__dirname, 'work')
const UI_BUNDLE_URL =
  'https://gitlab.com/antora/antora-ui-default/-/jobs/artifacts/HEAD/raw/build/ui-bundle.zip?job=bundle-stable'
const TMP_DIR = require('os').tmpdir()

describe('generateSite()', () => {
  let $
  let absDestDir
  let cacheDir
  let destDir
  let env
  let playbookSpec
  let playbookFile
  let repoBuilder
  let uiBundleUrl
  let gitServer

  const readFile = (file, dir) => fs.readFileSync(dir ? ospath.join(dir, file) : file, 'utf8')

  const loadHtmlFile = (relative) => loadHtml(readFile(relative, absDestDir))

  const getPlaybook = (playbookFile, extraArgs = []) => {
    const playbook = buildPlaybook(extraArgs.concat(['--playbook', playbookFile]), env)
    configureLogger(playbook.runtime.log)
    return playbook
  }

  before(async () => {
    destDir = 'public'
    absDestDir = ospath.join(WORK_DIR, destDir)
    playbookFile = ospath.join(WORK_DIR, 'antora-playbook.json')
    gitServer = new GitServer(CONTENT_REPOS_DIR, { autoCreate: false })
    const gitServerPort = await new Promise((resolve, reject) =>
      gitServer.listen(0, { type: 'http' }, function (err) {
        err ? reject(err) : resolve(this.address().port)
      })
    )
    repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
    uiBundleUrl = UI_BUNDLE_URL
  })

  beforeEach(async () => {
    env = { ANTORA_CACHE_DIR: (cacheDir = ospath.join(WORK_DIR, '.antora/cache')), ANTORA_LOG_FORMAT: 'json' }
    wipeSync(CONTENT_REPOS_DIR)
    fs.mkdirSync(WORK_DIR, { recursive: true })
    try {
      fs.unlinkSync(playbookFile)
    } catch (ioe) {
      if (ioe.code !== 'ENOENT') throw ioe
    }
    wipeSync(ospath.join(WORK_DIR, destDir.split('/')[0]))
    wipeSync(ospath.join(cacheDir, 'content'))
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
      .then(() => repoBuilder.close('main'))
    playbookSpec = {
      runtime: { quiet: true },
      site: { title: 'The Site' },
      content: {
        sources: [{ url: repoBuilder.repoPath, branches: 'v2.0' }],
      },
      ui: {
        bundle: { url: uiBundleUrl, snapshot: true },
      },
      output: {
        destinations: [{ provider: 'fs', path: '.' + ospath.sep + destDir }],
      },
    }
  })

  after(async () => {
    await closeServer(gitServer.server)
    wipeSync(CONTENT_REPOS_DIR)
    if (process.env.KEEP_CACHE) {
      wipeSync(ospath.join(WORK_DIR, destDir.split('/')[0]))
      fs.unlinkSync(playbookFile)
    } else {
      wipeSync(WORK_DIR)
    }
  })

  it('should generate site into output directory specified in playbook file', async () => {
    playbookSpec.site.start_page = '2.0@the-component::index.adoc'
    playbookSpec.site.keys = { 'google-analytics': 'UA-XXXXXXXX-1' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, '_')).to.be.a.directory().with.subDirs.with.members(['css', 'js', 'font', 'img'])
    const absCssDir = ospath.join(absDestDir, '_', 'css')
    expect(ospath.join(absDestDir, '_/css/site.css')).to.be.a.file()
    expect(absCssDir)
      .to.be.a.directory()
      .with.files.that.satisfy((files) =>
        files.every((file) => fs.statSync(ospath.join(absCssDir, file)).mode === 33206)
      )
    expect(ospath.join(absDestDir, '_/js/site.js')).to.be.a.file()
    expect(ospath.join(absDestDir, '404.html')).to.not.be.a.path()
    expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['2.0'])
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
    expect($('.page-versions')).to.not.be.found()
  })

  it('should bootstrap playbook and manage logger if first argument is an array', async () => {
    playbookSpec.site.start_page = 'the-component::no-such-page.adoc'
    playbookSpec.site.keys = { google_analytics: 'UA-XXXXXXXX-1' }
    const logRelpath = '.' + ospath.sep + destDir + ospath.sep + 'antora.log'
    const logPath = ospath.join(playbookFile, '..', destDir, 'antora.log')
    playbookSpec.runtime.log = { destination: { file: logRelpath, sync: false, buffer_size: 4096 } }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(['--playbook', playbookFile, '--cache-dir', env.ANTORA_CACHE_DIR, '--log-format', 'json'])
    expect(logPath).to.be.a.path()
    const messages = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((it) => JSON.parse(it))
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.include({
      level: 'warn',
      name: '@antora/content-classifier',
      msg: 'Start page specified for site not found: the-component::no-such-page.adoc',
    })
    expect(getLogger(null)).to.have.property('closed', true)
    expect(ospath.join(absDestDir, '_')).to.be.a.directory().with.subDirs.with.members(['css', 'js', 'font', 'img'])
    expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['2.0'])
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('head > script:first-of-type')).to.have.attr(
      'src',
      'https://www.googletagmanager.com/gtag/js?id=UA-XXXXXXXX-1'
    )
  })

  it('should bootstrap playbook with env if first argument is an array and second argument is an object', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    env.URL = 'https://docs.example.org'
    await generateSite(['--playbook', playbookFile], env)
    expect(ospath.join(absDestDir, '_')).to.be.a.directory().with.subDirs.with.members(['css', 'js', 'font', 'img'])
    expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['2.0'])
    expect(ospath.join(absDestDir, 'sitemap.xml'))
      .to.be.a.file()
      .with.contents.that.match(/https:\/\/docs\.example\.org\//)
  })

  it('should freeze playbook during generation', async () => {
    playbookSpec.output.destinations = []
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const playbook = getPlaybook(playbookFile)
    expect(Object.isFrozen(playbook)).to.be.false()
    await generateSite(playbook)
    expect(Object.isFrozen(playbook)).to.be.true()
    expect(Object.isFrozen(playbook.runtime)).to.be.true()
    expect(Object.isFrozen(playbook.env)).to.be.false()
  })

  it('should resolve dot-relative paths in playbook relative to playbook dir', async () => {
    const repoUrl = '.' + ospath.sep + ospath.relative(WORK_DIR, playbookSpec.content.sources[0].url)
    playbookSpec.content.sources[0].url = repoUrl
    const altWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
    fs.mkdirSync(altWorkDir, { recursive: true })
    const cwd = process.cwd()
    process.chdir(altWorkDir)
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    process.chdir(cwd)
    expect(ospath.join(absDestDir, '_')).to.be.a.directory().with.subDirs.with.members(['css', 'js', 'font', 'img'])
    expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['2.0'])
  })

  it('should generate site into output directory specified in arguments', async () => {
    const destDirOverride = ospath.join(destDir, 'beta')
    const absDestDirOverride = ospath.join(WORK_DIR, destDirOverride)
    playbookSpec.output.dir = '.' + ospath.sep + destDirOverride
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDirOverride, '_'))
      .to.be.a.directory()
      .with.subDirs.with.members(['css', 'js', 'font', 'img'])
    expect(ospath.join(absDestDirOverride, 'the-component')).to.be.a.directory().with.subDirs(['2.0'])
  })

  it('should use relative UI root path for page in ROOT module of ROOT component', async () => {
    await repoBuilder
      .init('the-root-component')
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'ROOT',
          version: '',
        })
      )
      .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/index.adoc', '= Home'))
      .then(() => repoBuilder.commitAll('add root component'))
      .then(() => repoBuilder.close())
    playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'index.html')).to.be.a.file()
    $ = loadHtmlFile('index.html')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', './_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', './_/js/site.js')
    expect($('nav.navbar .navbar-brand .navbar-item')).to.have.attr('href', '.')
    expect($('.nav-panel-explore li.component:last-of-type a')).to.have.attr('href', 'the-component/2.0/index.html')
  })

  it('should derive version from reference name if version key is set on content source', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v2.0'))
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-component',
          start_page: 'the-component::the-page.adoc',
          nav: ['modules/ROOT/nav.adoc'],
        })
      )
      .then(() => repoBuilder.removeFromWorktree('modules/ROOT/pages/index.adoc'))
      .then(() => repoBuilder.commitAll())
      .then(() => repoBuilder.close('main'))
    playbookSpec.content.sources[0].version = { 'v(?<version>+({0..9}))*': 'lts-$<version>' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['lts-2'])
    expect(ospath.join(absDestDir, 'the-component/lts-2/the-page.html')).to.be.a.file()
  })

  it('should use start page from latest version of component if version not specified', async () => {
    playbookSpec.site.start_page = 'the-component::index.adoc'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'index.html'))
      .to.be.a.file()
      .with.contents.that.match(/<meta http-equiv="refresh" content="0; url=the-component\/2.0\/index.html">/)
  })

  it('should log warning message if site start page is missing .adoc file extension', async () => {
    playbookSpec.site.start_page = 'the-component::index'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.include({
      level: 'warn',
      name: '@antora/content-classifier',
      msg: 'Start page specified for site not found: the-component::index',
    })
  })

  it('should log warning message if site start page cannot be resolved', async () => {
    playbookSpec.site.start_page = 'unknown-component::index.adoc'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.include({
      level: 'warn',
      name: '@antora/content-classifier',
      msg: 'Start page specified for site not found: unknown-component::index.adoc',
    })
  })

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
      .then(() => repoBuilder.close('main'))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.include({
      level: 'warn',
      name: '@antora/content-classifier',
      msg: 'Start page specified for 2.0@the-component not found: unknown-page.adoc',
    })
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('.nav-panel-explore .component.is-current .versions a').eq(0)).to.have.attr('href', 'index.html')
  })

  it('should log error message if xref cannot be resolved', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v2.0'))
      .then(() => repoBuilder.removeFromWorktree('modules/ROOT/pages/new-page.adoc'))
      .then(() => repoBuilder.commitAll())
      .then(() => repoBuilder.close('main'))
    playbookSpec.content.sources[0].url = repoBuilder.url
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
    expect(messages).to.have.lengthOf(2)
    ;['the-freshness.adoc', '2.0@the-freshness.adoc'].forEach((refSpec, idx) => {
      expect(messages[idx]).to.eql({
        level: 'error',
        name: 'asciidoctor',
        msg: `target of xref not found: ${refSpec}`,
        file: { path: 'modules/ROOT/pages/index.adoc' },
        source: { refname: 'v2.0', reftype: 'branch', url: repoBuilder.url },
      })
    })
  })

  it('should qualify applicable links using site url if set in playbook', async () => {
    playbookSpec.site.url = 'https://example.com/docs/'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'sitemap.xml')).to.be.a.file()
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html'))
      .to.be.a.file()
      .not.with.contents.that.match(/the-component\/2\.0\/_attributes\.html/)
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('head link[rel=canonical]')).to.have.attr('href', 'https://example.com/docs/the-component/2.0/index.html')
    expect($('nav.navbar .navbar-brand .navbar-item')).to.have.attr('href', 'https://example.com/docs')
  })

  it('should generate 404 page if site url is set to absolute URL in playbook', async () => {
    playbookSpec.site.url = 'https://example.com'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('Page Not Found :: The Site')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '/_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', '/_/js/site.js')
    expect($('.navbar-brand a.navbar-item')).to.have.attr('href', 'https://example.com')
    expect($('.nav-panel-explore .version.is-latest a')).to.have.attr('href', '/the-component/2.0/index.html')
    expect($('h1.page')).to.have.text('Page Not Found')
  })

  it('should generate 404 page if site url is set to absolute URL with subpath in playbook', async () => {
    playbookSpec.site.url = 'https://example.com/docs'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('Page Not Found :: The Site')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '/docs/_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', '/docs/_/js/site.js')
    expect($('.navbar-brand a.navbar-item')).to.have.attr('href', 'https://example.com/docs')
    expect($('.nav-panel-explore .version.is-latest a')).to.have.attr('href', '/docs/the-component/2.0/index.html')
  })

  it('should generate 404 page if site url is set to / in playbook', async () => {
    playbookSpec.site.url = '/'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('Page Not Found :: The Site')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '/_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', '/_/js/site.js')
    expect($('.navbar-brand a.navbar-item')).to.have.attr('href', '/')
    expect($('.nav-panel-explore .version.is-latest a')).to.have.attr('href', '/the-component/2.0/index.html')
  })

  it('should generate 404 page if site url is set to a pathname in the playbook', async () => {
    playbookSpec.site.url = '/docs'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('Page Not Found :: The Site')
    expect($('head > link[rel=stylesheet]')).to.have.attr('href', '/docs/_/css/site.css')
    expect($('body > script:first-of-type')).to.have.attr('src', '/docs/_/js/site.js')
    expect($('.navbar-brand a.navbar-item')).to.have.attr('href', '/docs')
    expect($('.nav-panel-explore .version.is-latest a')).to.have.attr('href', '/docs/the-component/2.0/index.html')
  })

  it('should allow 404 page to access site-wide page attributes', async () => {
    playbookSpec.site.url = 'https://example.com'
    playbookSpec.asciidoc = { attributes: { '404-page-title': 'No Such Page', 'page-foo': 'bar' } }
    playbookSpec.ui.supplemental_files = [
      {
        path: 'partials/head-meta.hbs',
        contents: '{{#if page.[404]}}<meta property="foo" content="{{page.attributes.foo}}">{{/if}}',
      },
    ]
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, '404.html')).to.be.a.file()
    $ = loadHtmlFile('404.html')
    expect($('head > title')).to.have.text('No Such Page :: The Site')
    expect($('head > meta[property=foo]')).to.have.attr('content', 'bar')
    expect($('h1.page')).to.have.text('No Such Page')
  })

  it('should be able to reference implicit page attributes', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('article').text()).to.include('This is version 2.0 of component the-component.')
  })

  it('should add document role to body tag', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/new-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/new-page.html')
    expect($('body.new')).to.be.found()
  })

  it('should pass AsciiDoc attributes defined in playbook to AsciiDoc processor', async () => {
    playbookSpec.asciidoc = {
      attributes: { sectanchors: null, sectnums: '', description: 'Stuff about stuff@' },
    }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('head meta[name=description]')).to.have.attr('content', 'Stuff about stuff')
    expect($('h2#_section_a')).to.have.html('1. Section A')
    expect($('h2#_section_b')).to.have.html('2. Section B')
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('head meta[name=description]')).to.have.attr('content', 'The almighty index page')
  })

  it('should pass AsciiDoc attributes defined in component descriptor to AsciiDoc processor', async () => {
    playbookSpec.asciidoc = {
      attributes: { sectanchors: null, description: false },
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
      .then(() => repoBuilder.checkoutBranch('v1.0'))
      .then(() =>
        repoBuilder.addComponentDescriptor({
          name: 'the-component',
          version: '1.0',
          nav: ['modules/ROOT/nav.adoc'],
        })
      )
      .then(() => repoBuilder.close('main'))
    playbookSpec.content.sources[0].branches = ['v2.0', 'v1.0']
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/1.0/the-page.html')
    expect($('head meta[name=description]')).to.not.be.found()
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('head meta[name=description]')).to.have.attr('content', 'Component description')
    expect($('h2#_section_a')).to.have.html('1. Section A')
    expect($('h2#_section_b')).to.have.html('2. Section B')
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/index.html')
    expect($('head meta[name=description]')).to.have.attr('content', 'The almighty index page')
  })

  it('should register extensions defined in playbook on AsciiDoc processor', async () => {
    const absExtensionPath = ospath.resolve(WORK_DIR, 'ext', 'shout-tree-processor.js')
    fs.mkdirSync(ospath.dirname(absExtensionPath), { recursive: true })
    fs.copyFileSync(ospath.resolve(FIXTURES_DIR, 'shout-tree-processor.js'), absExtensionPath)
    playbookSpec.asciidoc = {
      attributes: { volume: '3' },
      extensions: ['./ext/shout-tree-processor.js', ospath.resolve(FIXTURES_DIR, 'named-entity-postprocessor.js')],
    }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html'))
      .to.be.a.file()
      .with.contents.that.match(/Section A content!!!/)
      .and.with.contents.that.match(/&#169;/)
    global.Opal.Asciidoctor.Extensions.unregisterAll()
  })

  it('should be able to reference environment variable from UI template added as supplemental file', async () => {
    env.SITE_NAME = 'Learn All The Things!'
    playbookSpec.ui.supplemental_files = [
      {
        path: 'partials/head-meta.hbs',
        contents: '<meta property="og:site_name" content="{{env.SITE_NAME}}">',
      },
    ]
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html'))
      .to.be.a.file()
      .with.contents.that.match(/<meta property="og:site_name" content="Learn All The Things!">/)
  })

  it('should output UI to directory defined in playbook even if defined in UI bundle', async () => {
    playbookSpec.ui.output_dir = 'ui'
    playbookSpec.ui.supplemental_files = [
      {
        path: 'ui.yml',
        contents: 'output_dir: not-used',
      },
    ]
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'ui')).to.be.a.directory().with.subDirs.with.members(['css', 'js', 'font', 'img'])
  })

  it('should add edit page link to toolbar that links to edit URL if page.editUrl is set in UI model', async () => {
    const remoteGitUrl = 'git@gitlab.com:org/docs-repo.git'
    const remoteWebUrl = 'https://gitlab.com/org/docs-repo'
    const refname = 'v2.0'
    await repoBuilder
      .open()
      .then(() => repoBuilder.config('remote.origin.url', remoteGitUrl))
      .then(() => repoBuilder.close())
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl = `${remoteWebUrl}/edit/${refname}/${thePagePath}`
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  })

  it('should add edit page link to toolbar that links to custom edit URL', async () => {
    const editBaseUrl = repoBuilder.url.replace(/\.git$/, '')
    const refname = 'v2.0'
    playbookSpec.content.sources[0].url = repoBuilder.url
    playbookSpec.content.sources[0].edit_url = `${editBaseUrl}/edit/{refname}/{path}`
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl = `${editBaseUrl}/edit/${refname}/${thePagePath}`
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  })

  it('should not add edit page link to toolbar if repository is private', async () => {
    playbookSpec.content.sources[0].url = repoBuilder.url.replace('//', '//@')
    playbookSpec.content.sources[0].edit_url = `${repoBuilder.url.replace(/\.git$/, '')}/edit/{refname}/{path}`
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    expect($('.toolbar .edit-this-page')).to.not.be.found()
  })

  it('should add edit page link to toolbar for private repository if env.FORCE_SHOW_EDIT_PAGE_LINK=true', async () => {
    const editBaseUrl = repoBuilder.url.replace(/\.git$/, '')
    const refname = 'v2.0'
    playbookSpec.content.sources[0].url = repoBuilder.url.replace('//', '//@')
    playbookSpec.content.sources[0].edit_url = `${editBaseUrl}/edit/{refname}/{path}`
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    env.FORCE_SHOW_EDIT_PAGE_LINK = 'true'
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl = `${editBaseUrl}/edit/${refname}/${thePagePath}`
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  })

  it('should add edit page link to toolbar that links to local file if page.fileUri is set in UI model', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('v2.0'))
      .then(() => repoBuilder.close())
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    expect(env).to.not.have.property('CI')
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const expectedEditLinkUrl = pathToFileURL(ospath.join(repoBuilder.repoPath, thePagePath))
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', expectedEditLinkUrl)
  })

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
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    const thePagePath = 'modules/ROOT/pages/the-page.adoc'
    const editLinkUrl = `${remoteWebUrl}/edit/${refname}/${thePagePath}`
    expect($('.toolbar .edit-this-page a')).to.have.attr('href', editLinkUrl)
  })

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
      .then(() => repoBuilder.close('main'))
    playbookSpec.content.sources[0].branches = ['v2.0', 'v1.0']
    playbookSpec.runtime.log = { level: 'silent' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['1.0', '2.0'])
    expect(ospath.join(absDestDir, 'the-component/2.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/the-page.html')
    // assert that all versions of page are shown
    expect($('.page-versions')).to.be.found()
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
    expect($('.nav-panel-explore .component.is-current li.version').eq(0).find('a'))
      .to.have.text('2.0')
      .and.to.have.attr('href', 'index.html')
    expect($('.nav-panel-explore .component.is-current li.version').eq(1).find('a'))
      .to.have.text('1.0')
      .and.to.have.attr('href', '../1.0/index.html')
    expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/1.0/the-page.html')
    expect($('.nav-panel-explore .component.is-current .version')).to.have.lengthOf(2)
    expect($('.nav-panel-explore .component.is-current .version.is-latest a')).to.have.text('2.0')
    expect($('.nav-panel-explore .component.is-current .version.is-current a')).to.have.text('1.0')
  })

  it('should provide navigation to version named master', async () => {
    await repoBuilder
      .open()
      .then(() => repoBuilder.checkoutBranch('main'))
      .then(() => repoBuilder.deleteBranch('v2.0'))
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-other-component',
          version: 'master',
          start_page: 'core:index.adoc',
          nav: ['modules/core/nav.adoc'],
        })
      )
      .then(() => repoBuilder.importFilesFromFixture('the-other-component'))
      .then(() => repoBuilder.close('main'))
    delete playbookSpec.content.sources[0].branches
    playbookSpec.runtime.log = { level: 'silent' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-other-component')).to.be.a.directory()
    expect(ospath.join(absDestDir, 'the-other-component/core/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-other-component/core/index.html')
    expect($('.nav-panel-explore .component')).to.have.lengthOf(1)
    // assert correct component is marked as current
    expect($('.nav-panel-explore .component').eq(0)).to.have.class('is-current')
    expect($('.nav-panel-explore .component.is-current a')).to.have.lengthOf(2)
    expect($('.nav-panel-explore .component.is-current .title a')).to.have.lengthOf(1)
    expect($('.nav-panel-explore .component.is-current .title a').eq(0)).to.have.text('The Other Component')
    expect($('.nav-panel-explore .component.is-current .versions a')).to.have.lengthOf(1)
    expect($('.nav-panel-explore .component.is-current .versions a').eq(0)).to.have.text('master')
    expect($('.nav-panel-explore .component.is-current .version').eq(0))
      .to.have.class('is-current')
      .and.to.have.class('is-latest')
  })

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
      .then(() => repoBuilder.close('main'))
    await repoBuilder
      .init('the-other-component')
      .then(() =>
        repoBuilder.addComponentDescriptorToWorktree({
          name: 'the-other-component',
          version: '',
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
      .then(() => repoBuilder.close('main'))

    playbookSpec.content.sources[0].branches = ['v2.0', 'v1.0']
    playbookSpec.content.sources.push({
      url: repoBuilder.repoPath,
      branches: ['main', 'v1.0'],
    })
    playbookSpec.runtime.log = { level: 'silent' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-other-component')).to.be.a.directory()
    expect(ospath.join(absDestDir, 'the-other-component/core/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-other-component/core/index.html')
    expect($('.nav-panel-explore .component')).to.have.lengthOf(2)
    // assert sorted by title
    expect($('.nav-panel-explore .component').eq(0).find('.title')).to.have.text('The Component')
    expect($('.nav-panel-explore .component').eq(1).find('.title')).to.have.text('The Other Component')
    // assert correct component is marked as current
    expect($('.nav-panel-explore .component').eq(1)).to.have.class('is-current')
    expect($('.nav-panel-explore .component.is-current a')).to.have.lengthOf(3)
    expect($('.nav-panel-explore .component.is-current .title a')).to.have.lengthOf(1)
    expect($('.nav-panel-explore .component.is-current .versions a')).to.have.lengthOf(2)
    expect($('.nav-panel-explore .component.is-current .versions a').eq(0)).to.have.text('default')
    expect($('.nav-panel-explore .component.is-current .version').eq(0))
      .to.have.class('is-current')
      .and.to.have.class('is-latest')
    expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.be.a.file()
    $ = loadHtmlFile('the-component/2.0/index.html')
    // assert component link points to start page
    expect($('.nav-panel-explore .component:not(.is-current) .title a')).to.have.attr(
      'href',
      '../../the-other-component/core/index.html'
    )
    expect($('.nav-panel-explore .component:not(.is-current) .versions a').eq(0)).to.have.attr(
      'href',
      '../../the-other-component/core/index.html'
    )
  })

  it('should resolve xrefs that use an alias as the target', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    const contents = readFile('the-component/2.0/index.html', absDestDir)
    expect(contents).to.include('<a href="the-page.html" class="xref page">its alias</a>')
    expect(contents).to.include('<a href="new-page.html" class="xref page">the new page</a>')
    expect(contents).to.include('<a href="new-page.html" class="xref page">2.0</a>')
  })

  // NOTE this also tests that aliases do not have to have the .adoc file extension
  it('should generate static redirect files for aliases by default', async () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, 'the-component/2.0/the-alias.html')).to.be.a.file()
    let contents = readFile('the-component/2.0/the-alias.html', absDestDir)
    expect(contents).to.include('<script>location="the-page.html"</script>')
    contents = readFile('the-component/2.0/the-freshness.html', absDestDir)
    expect(contents).to.include('<script>location="new-page.html"</script>')
  })

  // NOTE this also tests that aliases do not have to have the .adoc file extension
  it('should generate nginx rewrite config file for aliases when using nginx redirect facility', async () => {
    playbookSpec.urls = { redirect_facility: 'nginx' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
    expect(ospath.join(absDestDir, '.etc/nginx/rewrite.conf')).to.be.a.file()
    const contents = readFile('.etc/nginx/rewrite.conf', absDestDir)
    const rule2 = 'location = /the-component/2.0/the-freshness.html { return 301 /the-component/2.0/new-page.html; }'
    const rule1 = 'location = /the-component/2.0/the-alias.html { return 301 /the-component/2.0/the-page.html; }'
    expect(contents).to.include(rule1)
    expect(contents).to.include(rule2)
    expect(ospath.join(absDestDir, 'the-component/2.0/the-alias.html')).to.not.be.a.path()
    expect(ospath.join(absDestDir, 'the-component/2.0/the-freshness.html')).to.not.be.a.path()
  })

  it('should indexify URLs to internal pages', async () => {
    playbookSpec.urls = { html_extension_style: 'indexify' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    await generateSite(getPlaybook(playbookFile))
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
  })

  describe('extensions', () => {
    const LIB_DIR = ospath.join(WORK_DIR, 'lib')
    let extensionNumber = 1 // NOTE alternative is to clearModule after each test

    beforeEach(() => {
      wipeSync(LIB_DIR)
      fs.mkdirSync(LIB_DIR)
      playbookSpec.antora = {}
      playbookSpec.ui.bundle = { url: ospath.join(FIXTURES_DIR, 'minimal-ui') }
    })

    after(() => wipeSync(LIB_DIR))

    it('should require and register extension specified as a string', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = () => console.log('extension initialized')
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('extension initialized')
    })

    it('should require and register extension specified as a map containing a require property', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = () => console.log('extension initialized')
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [{ require: extensionPath }]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('extension initialized')
    })

    it('should throw TypeError if require key is missing from extension defined as map', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = () => console.log('extension initialized')
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [{ key: 'value' }]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const expectedMessage = 'The "request" argument must be of type string. Received type undefined'
      expect(await trapAsyncError(generateSite, getPlaybook(playbookFile))).to.throw(TypeError, expectedMessage)
    })

    it('should not attempt to invoke register function if register method is not defined on module', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        console.log('extension required')
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('extension required')
    })

    it('should not attempt to invoke register function if module has undefined exports', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        console.log('extension required')
        module.exports = undefined
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('extension required')
    })

    it('should warn if Asciidoctor extension is registered as Antora extension', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        // emulate a hybrid AsciiDoc / Antora extension
        module.exports.register = (registry, context) => {
          if (context?.playbook) {
            registry.getLogger().warn('register called')
            return
          }
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
      expect(messages).to.have.lengthOf(2)
      expect(messages[0]).to.include({
        level: 'warn',
        name: 'antora',
        msg: `Detected Asciidoctor extension registered as an Antora extension: ${extensionPath}`,
      })
      expect(messages[1]).to.include({
        level: 'warn',
        name: 'antora',
        msg: 'register called',
      })
    })

    it('should skip and warn if possible AsciiDoc extension is registered as Antora extension and fails to load', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        const FooInlineMacro = (() => {
          throw new ReferenceError('Opal is not defined')
        })()

        module.exports.register = (registry, context) => {
          throw new Error('should not run')
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.include({
        level: 'warn',
        name: 'antora',
        msg: `Skipping possible Asciidoctor extension registered as an Antora extension: ${extensionPath}`,
      })
    })

    it('should allow extension to be registered with configuration parameters', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function ({ config }) {
          console.log('extension initialized with config: ' + JSON.stringify(config))
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [{ id: 'my-extension', require: extensionPath, foo: 'bar', yin: ['yang'] }]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('extension initialized with config: {"foo":"bar","yin":["yang"]}')
    })

    it('should not register extension if enabled key is specified on configuration and value is false', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = () => console.log('extension initialized')
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [{ require: extensionPath, enabled: false }]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.be.empty()
    })

    it('should pass playbook to extension function via the context variables parameter', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function ({ playbook }) {
          console.log('register function bound to ' + this.constructor.name)
          console.log('extension initialized for site: ' + playbook.site.url)
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      playbookSpec.site.url = 'https://docs.example.org'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(2)
      expect(lines[0]).to.equal('register function bound to GeneratorContext')
      expect(lines[1]).to.equal('extension initialized for site: https://docs.example.org')
    })

    it('should pass generator context as argument if declared as parameter of bindable function', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function (generator, { playbook }) {
          console.log('generator instanceof ' + generator.constructor.name)
          console.log(this === generator ? 'this is bound' : 'this is not bound')
          generator.on('playbookBuilt', () => {
            console.log('extension initialized for site: ' + playbook.site.url)
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      playbookSpec.site.url = 'https://docs.example.org'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(3)
      expect(lines[0]).to.equal('generator instanceof GeneratorContext')
      expect(lines[1]).to.equal('this is not bound')
      expect(lines[2]).to.equal('extension initialized for site: https://docs.example.org')
    })

    it('should pass generator context as argument if declared as parameter of arrow function', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = (generator, { playbook }) => {
          console.log('generator instanceof ' + generator.constructor.name)
          console.log(this === generator ? 'this is bound' : 'this is not bound')
          generator.on('playbookBuilt', () => {
            console.log('extension initialized for site: ' + playbook.site.url)
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      playbookSpec.site.url = 'https://docs.example.org'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(3)
      expect(lines[0]).to.equal('generator instanceof GeneratorContext')
      expect(lines[1]).to.equal('this is not bound')
      expect(lines[2]).to.equal('extension initialized for site: https://docs.example.org')
    })

    it('should pass generator context as argument if declared as parameter of shorthand arrow function', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = context => context.on('playbookBuilt', () => console.log('playbook built!'))
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('playbook built!')
    })

    it('should support static register method on class-based extension', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        class MyExtension${extensionNumber} {
          static register () {
            new MyExtension${extensionNumber}(this)
          }

          constructor (generatorContext) {
            ;(this.context = generatorContext)
              .on('playbookBuilt', this.onPlaybookBuilt.bind(this))
              .on('sitePublished', this.onSitePublished.bind(this))
          }

          onPlaybookBuilt ({ playbook }) {
            this.context.removeAllListeners('sitePublished')
            this.printReport(playbook.site.title)
          }

          onSitePublished () {
            console.log('site published')
          }

          printReport (siteTitle) {
            console.log('extension initialized for ' + siteTitle)
          }
        }

        module.exports = MyExtension${extensionNumber}
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('extension initialized for The Site')
    })

    it('should allow extension to listen for events', async () => {
      const common = ['playbook', 'siteAsciiDocConfig', 'siteCatalog']
      const events = {
        contextStarted: [common[0]],
        playbookBuilt: [common[0]],
        beforeProcess: common.slice().sort(),
        contentAggregated: [...common, 'contentAggregate'].sort(),
        uiLoaded: [...common, 'uiCatalog'].sort(),
        contentClassified: [...common, 'contentCatalog', 'uiCatalog'].sort(),
        documentsConverted: [...common, 'contentCatalog', 'uiCatalog'].sort(),
        navigationBuilt: [...common, 'contentCatalog', 'uiCatalog', 'navigationCatalog'].sort(),
        pagesComposed: [...common, 'contentCatalog', 'uiCatalog'].sort(),
        siteMapped: [...common, 'contentCatalog', 'uiCatalog'].sort(),
        redirectsProduced: [...common, 'contentCatalog', 'uiCatalog'].sort(),
        beforePublish: [...common, 'contentCatalog', 'uiCatalog'].sort(),
        sitePublished: [...common, 'contentCatalog', 'uiCatalog', 'publications'].sort(),
        contextClosed: [...common, 'contentCatalog', 'uiCatalog'].sort(),
      }
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function ({ config: { events }, playbook }) {
          const observed = playbook.env.OBSERVED = []
          events.forEach((name) => {
            this.on(name, function (vars) {
              observed.push([name, Object.keys(vars).sort()])
            })
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [{ require: extensionPath, events: Object.keys(events) }]
      playbookSpec.site.url = 'https://docs.example.org'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      await generateSite(getPlaybook(playbookFile))
      // NOTE using env here only works because env is a custom object
      const observed = env.OBSERVED
      const eventNamesEmitted = observed.map(([name]) => name)
      // NOTE contextClosed should always be the last event emitted
      expect(eventNamesEmitted[eventNamesEmitted.length - 1]).to.equal('contextClosed')
      expect(eventNamesEmitted.sort()).to.eql(Object.keys(events).sort())
      const varsByEvent = observed.reduce((accum, [name, vars]) => (accum[name] = vars) && accum, {})
      Object.entries(events).forEach(([name, vars]) => expect(varsByEvent[name]).to.include.members(vars))
    })

    it('should allow extension to listen for events using once', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.once('uiLoaded', ({ uiCatalog }) => {
            console.log('uiCatalog is ' + (uiCatalog ? 'found' : 'not found'))
            console.log('listeners: ' + this.rawListeners('uiLoaded').length)
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(2)
      expect(lines[0]).to.equal('uiCatalog is found')
      expect(lines[1]).to.equal('listeners: 0')
    })

    it('should freeze playbook after playbookBuilt event is fired', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function ({ playbook }) {
          this.on('playbookBuilt', () => {
            console.log('frozen at playbookBuilt: ' + (Object.isFrozen(playbook) ? 'true' : 'false'))
          })
          this.on('beforeProcess', () => {
            console.log('frozen at beforeProcess: ' + (Object.isFrozen(playbook) ? 'true' : 'false'))
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      playbookSpec.output.destinations = []
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.eql(['frozen at playbookBuilt: false', 'frozen at beforeProcess: true'])
    })

    it('should always emit contentClassified event after both content is classified and UI is loaded', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function ({ config }) {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
          this.on('contentAggregated', async () => {
            if (config.delay === 'contentAggregated') await sleep(250)
            console.log('contentAggregated')
          })
          this.on('uiLoaded', async () => {
            if (config.delay === 'uiLoaded') await sleep(250)
            console.log('uiLoaded')
          })
          this.on('contentClassified', ({ contentCatalog, uiCatalog }) => {
            if (contentCatalog && uiCatalog) console.log('contentClassified')
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      for (const delay of ['contentAggregated', 'uiLoaded']) {
        playbookSpec.antora.extensions = [{ require: extensionPath, delay }]
        fs.writeFileSync(playbookFile, toJSON(playbookSpec))
        const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
        expect(lines).to.have.lengthOf(3)
        const expectedNames = ['contentAggregated', 'uiLoaded', 'contentClassified'].filter((it) => it !== delay)
        expectedNames.splice(1, 0, delay)
        expect(lines).to.eql(expectedNames)
      }
    })

    it('should execute listeners for event in order extensions are registered', async () => {
      const extensionAPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionBPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionACode = heredoc`
        module.exports.register = function () {
          this.on('beforePublish', () => console.log('before publish a'))
        }
      `
      const extensionBCode = heredoc`
        module.exports.register = function () {
          this.on('beforePublish', () => console.log('before publish b'))
        }
      `
      fs.writeFileSync(extensionAPath, extensionACode)
      fs.writeFileSync(extensionBPath, extensionBCode)
      playbookSpec.antora.extensions = [extensionAPath, extensionBPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(2)
      expect(lines[0]).to.equal('before publish a')
      expect(lines[1]).to.equal('before publish b')
    })

    it('should execute and wait for async listeners for event in order extensions are registered', async () => {
      const extensionAPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionBPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionACode = heredoc`
        module.exports.register = function () {
          this.on('beforePublish', async () => {
            await new Promise((resolve) => setTimeout(resolve, 100))
            console.log('before publish a')
          })
        }
      `
      const extensionBCode = heredoc`
        module.exports.register = function () {
          this.on('beforePublish', async () => {
            await new Promise((resolve) => setImmediate(resolve))
            console.log('before publish b')
          })
        }
      `
      fs.writeFileSync(extensionAPath, extensionACode)
      fs.writeFileSync(extensionBPath, extensionBCode)
      playbookSpec.antora.extensions = [extensionAPath, extensionBPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(2)
      expect(lines[0]).to.equal('before publish a')
      expect(lines[1]).to.equal('before publish b')
    })

    it('should allow listener to register itself before other listeners', async () => {
      const extensionAPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionBPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionACode = heredoc`
        module.exports.register = function () {
          this.on('beforePublish', () => console.log('before publish a'))
        }
      `
      const extensionBCode = heredoc`
        module.exports.register = function () {
          this.prependListener('beforePublish', () => console.log('before publish b'))
        }
      `
      fs.writeFileSync(extensionAPath, extensionACode)
      fs.writeFileSync(extensionBPath, extensionBCode)
      playbookSpec.antora.extensions = [extensionAPath, extensionBPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(2)
      expect(lines[0]).to.equal('before publish b')
      expect(lines[1]).to.equal('before publish a')
    })

    it('should allow listener to use context to listen for and emit custom events', async () => {
      const extensionAPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionBPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionACode = heredoc`
        module.exports.register = function () {
          this.on('beforePublish', () => {
            this.emit('lunr:siteIndexed', 500)
          })
        }
      `
      const extensionBCode = heredoc`
        module.exports.register = function () {
          this.on('lunr:siteIndexed', (numRecords) => console.log('generated index with ' + numRecords + ' records'))
        }
      `
      fs.writeFileSync(extensionAPath, extensionACode)
      fs.writeFileSync(extensionBPath, extensionBCode)
      playbookSpec.antora.extensions = [extensionAPath, extensionBPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('generated index with 500 records')
    })

    it('should allow extension listener to access context variables via listener argument', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.on('contentClassified', ({ playbook, contentCatalog }) => {
            console.log('building ' + contentCatalog.getPages().length + ' pages for site ' + playbook.site.url)
          })
          this.on('beforeProcess', ({ siteCatalog }) => {
            siteCatalog.addFile({
              contents: Buffer.alloc(0),
              out: { path: '.nojekyll' }
            })
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      playbookSpec.site.url = 'https://docs.example.org'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('building 4 pages for site https://docs.example.org')
      expect(ospath.join(absDestDir, '.nojekyll')).to.be.a.file().and.be.empty()
    })

    it('should allow extension listener to access context variables via getVariables', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.on('contentClassified', function () {
            const { playbook, contentCatalog } = this.getVariables()
            console.log('building ' + contentCatalog.getPages().length + ' pages for site ' + playbook.site.url)
          })
          this.on('beforeProcess', () => {
            this.getVariables().siteCatalog.addFile({
              contents: Buffer.alloc(0),
              out: { path: '.nojekyll' }
            })
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      playbookSpec.site.url = 'https://docs.example.org'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('building 4 pages for site https://docs.example.org')
      expect(ospath.join(absDestDir, '.nojekyll')).to.be.a.file().and.be.empty()
    })

    it('should not allow extension listener to access vars property on generator context', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.on('playbookBuilt', function () {
            console.log(this.vars == null ? 'is null' : 'is not null')
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('is null')
    })

    it('should allow extension listener to update writable context variables in register function', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function ({ playbook }) {
          const site = Object.assign({}, playbook.site, { url: 'https://docs.example.com' })
          this.updateVariables({ playbook: Object.assign({}, playbook, { site }) })
          if (!this.getVariables().playbook.env) this.stop()
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      await generateSite(getPlaybook(playbookFile))
      expect(ospath.join(absDestDir, 'sitemap.xml'))
        .to.be.a.file()
        .with.contents.that.match(/https:\/\/docs\.example\.com\//)
    })

    it('should allow extension listener to update writable context variables in event listener', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this
            .on('contentClassified', function ({ playbook, contentCatalog }) {
              const contentCatalogProxy = new Proxy(contentCatalog, {
                get (target, property) {
                  if (property === 'getPages' || property === 'getFiles') {
                    return (...args) =>
                      target[property].apply(target, args).filter((it) => it.src.relative !== 'index.adoc')
                  }
                  return target[property]
                }
              })
              this.updateVariables({ contentCatalog: contentCatalogProxy })
            })
            .on('beforePublish', ({ contentCatalog }) => {
              console.log('publishing ' + contentCatalog.getPages((page) => page.out).length + ' pages')
            })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('publishing 2 pages')
      expect(ospath.join(absDestDir, 'the-component/2.0/index.html')).to.not.be.a.path()
    })

    it('should allow one extension listener to see context variables set by previous listener', async () => {
      const extensionAPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionBPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionACode = heredoc`
        module.exports.register = function () {
          this.on('playbookBuilt', function ({ playbook }) {
            const site = Object.assign({}, playbook.site, { url: 'https://docs.example.com' })
            this.updateVariables({ playbook: Object.assign({}, playbook, { site }) })
          })
        }
      `
      const extensionBCode = heredoc`
        module.exports.register = function () {
          this.on('playbookBuilt', ({ playbook }) => console.log('building site for ' + playbook.site.url))
        }
      `
      fs.writeFileSync(extensionAPath, extensionACode)
      fs.writeFileSync(extensionBPath, extensionBCode)
      playbookSpec.antora.extensions = [extensionAPath, extensionBPath]
      playbookSpec.site.url = 'https://docs.example.org'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal('building site for https://docs.example.com')
    })

    it('should not allow extension listener to update locked context variables', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this
            .on('contentClassified', function ({ playbook, contentCatalog }) {
              this.updateVariables({ playbook: {} })
            })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const expectedMessage = "Cannot update locked variable 'playbook'"
      expect(await trapAsyncError(generateSite, getPlaybook(playbookFile))).to.throw(TypeError, expectedMessage)
    })

    it('should allow extension listener to lock a context variable which is not locked', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this
            .on('beforeProcess', () => {
              this.updateVariables({ foo: 'bar' })
              this.lockVariable('foo')
            })
            .on('contentClassified', () => {
              this.removeVariable('foo')
            })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const expectedMessage = "Cannot remove locked variable 'foo'"
      expect(await trapAsyncError(generateSite, getPlaybook(playbookFile))).to.throw(TypeError, expectedMessage)
    })

    it('should allow extension listener to lock a context variable which is already locked', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this
            .on('beforeProcess', () => {
              this.updateVariables({ foo: 'bar' })
              this.lockVariable('foo')
            })
            .on('contentClassified', () => {
              this.lockVariable('foo')
              this.stop()
            })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      expect(await trapAsyncError(generateSite, getPlaybook(playbookFile))).to.not.throw()
    })

    it('should allow context variable to be named lock', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this
            .on('playbookBuilt', () => this.updateVariables({ lock: 'safe' }))
            .on('beforeProcess', () => this.stop())
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      expect(await trapAsyncError(generateSite, getPlaybook(playbookFile))).to.not.throw()
    })

    it('should allow context variable to be named remove', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this
            .on('playbookBuilt', () => this.updateVariables({ remove: 'safe' }))
            .on('beforeProcess', () => this.stop())
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      expect(await trapAsyncError(generateSite, getPlaybook(playbookFile))).to.not.throw()
    })

    it('should allow extension listener to require internal modules', async () => {
      const extensionPath = ospath.join(TMP_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.on('beforePublish', function () {
            const logger = this.require('@antora/logger')('my-extension')
            logger.info('time to publish!')
          })
        }
      `
      try {
        fs.writeFileSync(extensionPath, extensionCode)
        playbookSpec.runtime.log = { level: 'info' }
        playbookSpec.antora.extensions = [extensionPath]
        fs.writeFileSync(playbookFile, toJSON(playbookSpec))
        const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
        expect(messages).to.have.lengthOf(1)
        expect(messages[0]).to.include({ level: 'info', name: 'my-extension', msg: 'time to publish!' })
      } finally {
        fs.unlinkSync(extensionPath) // remove explicitly since it's outside of work dir
      }
    })

    it('should allow extension listener to access default logger using getLogger on generator context', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.getLogger().info('Extension loaded.')
          this.on('sitePublished', function () {
            this.getLogger().info('Site published!')
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.runtime.log = { level: 'info' }
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
      expect(messages).to.have.lengthOf(2)
      expect(messages[0]).to.include({ level: 'info', name: 'antora', msg: 'Extension loaded.' })
      expect(messages[1]).to.include({ level: 'info', name: 'antora', msg: 'Site published!' })
    })

    it('should allow extension listener to access named logger using getLogger on generator context', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.getLogger('my-extension').info('Extension loaded.')
          this.on('sitePublished', function () {
            this.getLogger('my-extension').info('Site published!')
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.runtime.log = { level: 'info' }
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const messages = await captureStdoutLog(() => generateSite(getPlaybook(playbookFile)))
      expect(messages).to.have.lengthOf(2)
      expect(messages[0]).to.include({ level: 'info', name: 'my-extension', msg: 'Extension loaded.' })
      expect(messages[1]).to.include({ level: 'info', name: 'my-extension', msg: 'Site published!' })
    })

    it('should not closer logger before sitePublished event when playbook is bootstrapped', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.getLogger('my-extension').info('Extension loaded.')
          this.on('sitePublished', function () {
            this.getLogger('my-extension').info('Site published!')
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      const logRelpath = '.' + ospath.sep + destDir + ospath.sep + 'antora.log'
      const logPath = ospath.join(playbookFile, '..', destDir, 'antora.log')
      playbookSpec.runtime.log = { destination: { file: logRelpath, sync: false, buffer_size: 4096 }, level: 'info' }
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const args = ['--playbook', playbookFile, '--cache-dir', env.ANTORA_CACHE_DIR, '--log-format', 'json']
      const lines = await captureStderr(() => generateSite(args))
      expect(lines[0]).to.be.undefined()
      expect(logPath).to.be.a.path()
      const messages = fs
        .readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .map((it) => JSON.parse(it))
      expect(messages).to.have.lengthOf(2)
      expect(messages[0]).to.include({ level: 'info', name: 'my-extension', msg: 'Extension loaded.' })
      expect(messages[1]).to.include({ level: 'info', name: 'my-extension', msg: 'Site published!' })
    })

    it('should allow extension listener to access module of generator', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          console.log(this.module.path)
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.runtime.log = { level: 'info' }
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      const expectedMessage = ospath.dirname(require.resolve('@antora/site-generator'))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.equal(expectedMessage)
    })

    it('should allow extension listener to invoke stop to stop processing', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.on('beforePublish', function () {
            this.stop()
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      await generateSite(getPlaybook(playbookFile))
      expect(absDestDir).to.not.be.a.path()
      expect(process.exitCode).to.be.undefined()
    })

    it('should allow extension listener to invoke stop with code to stop processing', async () => {
      try {
        const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
        const extensionCode = heredoc`
          module.exports.register = function () {
            this.on('playbookBuilt', function () {
              this.stop(200)
            })
          }
        `
        fs.writeFileSync(extensionPath, extensionCode)
        playbookSpec.antora.extensions = [extensionPath]
        fs.writeFileSync(playbookFile, toJSON(playbookSpec))
        await generateSite(getPlaybook(playbookFile))
        expect(absDestDir).to.not.be.a.path()
        expect(process.exitCode).to.equal(200)
      } finally {
        process.exitCode = undefined
      }
    })

    it('should notify event listeners of other extensions when context is stopped and closed', async () => {
      const extensionAPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionBPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionACode = heredoc`
        module.exports.register = function () {
          this.on('contentClassified', () => this.stop())
          this.on('beforePublish', () => console.log('never called'))
        }
      `
      const extensionBCode = heredoc`
        module.exports.register = function () {
          this.on('contextStopped', () => console.log('context stopped'))
          this.on('contextClosed', () => console.log('context closed'))
        }
      `
      fs.writeFileSync(extensionAPath, extensionACode)
      fs.writeFileSync(extensionBPath, extensionBCode)
      playbookSpec.antora.extensions = [extensionAPath, extensionBPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(2)
      expect(lines[0]).to.equal('context stopped')
      expect(lines[1]).to.equal('context closed')
      expect(absDestDir).to.not.be.a.path()
      expect(process.exitCode).to.be.undefined()
    })

    it('should allow extension listener to add HTML file as page to content catalog', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.on('contentClassified', ({ contentCatalog }) => {
            const page = contentCatalog.addFile({
              contents: Buffer.from('<p>the contents</p>'),
              src: {
                component: 'the-component',
                version: '2.0',
                module: 'ROOT',
                family: 'page',
                relative: 'new-page.html',
              },
            })
            page.asciidoc = { doctitle: 'New Page' }
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const expectedContents = heredoc`
        <!DOCTYPE html>
        <html>
        <body>
        <article>
        <h1>New Page</h1>
        <p>the contents</p>
        </article>
        </body>
        </html>
      `
      await generateSite(getPlaybook(playbookFile))
      expect(ospath.join(absDestDir, 'the-component/2.0/new-page.html'))
        .to.be.a.file()
        .with.contents(expectedContents + '\n')
    })

    it('should allow extension listener to remove file from site catalog', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.on('beforeProcess', ({ siteCatalog }) => {
            siteCatalog.addFile({
              contents: Buffer.alloc(0),
              out: { path: '.nojekyll' }
            })
            console.log('' + siteCatalog.removeFile({ out: { path: '.nojekyll' } }))
            console.log('' + siteCatalog.removeFile({ out: { path: '.nojekyll' } }))
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(2)
      expect(lines).to.eql(['true', 'false'])
      expect(ospath.join(absDestDir, '.nojekyll')).to.not.be.a.path()
    })

    it('should allow register function to replace functions on generator context', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        const mapSite = (playbook, publishableFiles) => {
          console.log('creating sitemap with ' + publishableFiles.length + ' files for ' + playbook.site.url)
          return []
        }

        const publishFiles = async () => {
          console.log('not publishing today')
          return []
        }

        module.exports.register = function () {
          this.replaceFunctions({ mapSite, publishFiles })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      playbookSpec.site.url = 'https://docs.example.org'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.have.lengthOf(2)
      expect(lines[0]).to.equal('creating sitemap with 3 files for https://docs.example.org')
      expect(lines[1]).to.equal('not publishing today')
    })

    it('should map publishSite function to publishFiles', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        const publishSite = async () => {
          console.log('not publishing today')
          return []
        }

        module.exports.register = function () {
          this.replaceFunctions({ publishSite })

          this.once('contextStarted', () => {
            if (this.getFunctions().publishSite !== this.getFunctions().publishFiles) console.log('different!')
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.eql(['not publishing today'])
    })

    it('should allow extension listener to access generator functions via getFunctions', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          const observedOnRegister = Object.keys(this.getFunctions())
          this.on('beforeProcess', ({ playbook }) => {
            playbook.env.OBSERVED_ON_REGISTER = observedOnRegister
            playbook.env.OBSERVED_BEFORE_PROCESS = Object.keys(this.getFunctions()).sort()
          })
          this.on('beforePublish', ({ contentCatalog, siteCatalog }) => {
            const { loadAsciiDoc } = this.getFunctions()
            const file = {
              contents: Buffer.from('xref:the-component::the-page.adoc[]'),
              src: { component: '', version: '', module: 'ROOT', family: 'page', relative: 'generated-page.adoc' },
              out: { path: 'generated-page.html' },
              pub: { moduleRootPath: '', url: '/generated-page.html' }
            }
            file.contents = Buffer.from(loadAsciiDoc(file, contentCatalog).convert())
            siteCatalog.addFile(file)
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      await generateSite(getPlaybook(playbookFile))
      // NOTE using env here only works because env is a custom object
      expect(env.OBSERVED_ON_REGISTER).to.eql(['publishSite'])
      expect(env.OBSERVED_BEFORE_PROCESS).to.eql([
        'aggregateContent',
        'buildNavigation',
        'classifyContent',
        'convertDocument',
        'convertDocuments',
        'createPageComposer',
        'extractAsciiDocMetadata',
        'loadAsciiDoc',
        'loadUi',
        'mapSite',
        'produceRedirects',
        'publishFiles',
        'publishSite',
        'resolveAsciiDocConfig',
      ])
      expect(ospath.join(absDestDir, 'generated-page.html'))
        .to.be.a.file()
        .with.contents.that.match(/href="the-component\/2.0\/the-page.html"[^>]*>The Page</)
    })

    it('should allow contextStarted listener to proxy functions on the generator context', async () => {
      const extensionPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const extensionCode = heredoc`
        module.exports.register = function () {
          this.once('contextStarted', () => {
            const { produceRedirects } = this.getFunctions()
            this.replaceFunctions({
              produceRedirects: (playbook, originalAliases) => {
                originalAliases.forEach((alias) => delete alias.out)
                return produceRedirects(playbook, [{
                  pub: { url: '/acme/from.html' },
                  rel: { pub: { url: '/acme/to.html' } },
                }])
              }
            })
          })
        }
      `
      fs.writeFileSync(extensionPath, extensionCode)
      playbookSpec.antora.extensions = [extensionPath]
      playbookSpec.urls = { redirect_facility: 'netlify' }
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      await generateSite(getPlaybook(playbookFile))
      expect(ospath.join(absDestDir, '_redirects'))
        .to.be.a.file()
        .with.contents.that.match(/^\/acme\/from\.html \/acme\/to\.html 301!/)
      expect(ospath.join(absDestDir, 'the-component/2.0/the-alias.html')).to.not.be.a.path()
    })

    it('should not require custom output provider to return a value', async () => {
      const providerPath = ospath.join(LIB_DIR, `my-extension-${extensionNumber++}.js`)
      const providerCode = heredoc`
        module.exports = async (dest, files, playbook) => {
          console.log('publish files to ' + dest.path)
        }
      `
      fs.writeFileSync(providerPath, providerCode)
      playbookSpec.runtime.quiet = false
      playbookSpec.output.destinations[0].provider = providerPath
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const lines = await captureStdout(() => generateSite(getPlaybook(playbookFile)))
      expect(lines).to.not.be.empty()
      expect(lines[0]).to.equal('publish files to ' + playbookSpec.output.destinations[0].path)
    })
  })

  describe('integration', () => {
    it('should output archive from site generated from git repository', async () => {
      const archivePath = ['.', destDir, 'site.zip'].join(ospath.sep)
      const absArchivePath = ospath.join(WORK_DIR, archivePath)
      playbookSpec.content.sources[0].url = repoBuilder.url
      playbookSpec.output.destinations[0] = { provider: 'archive', path: archivePath }
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      await generateSite(getPlaybook(playbookFile))
      expect(absArchivePath).to.be.a.file()
    })

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
        await generateSite(getPlaybook(playbookFile))
        expect(progressLines).to.have.lengthOf.at.least(2)
        expect(progressLines[0]).to.include('[clone] ' + repoBuilder.url)
        expect(progressLines[0]).to.match(/ \[-+\]/)
        expect(progressLines[progressLines.length - 1]).to.match(/ \[#+\]/)

        progressLines.length = 0
        await generateSite(getPlaybook(playbookFile))
        expect(progressLines).to.be.empty()

        // TODO assert that the UI was downloaded again
        await generateSite(getPlaybook(playbookFile, ['--fetch']))
        expect(progressLines).to.have.lengthOf.at.least(2)
        expect(progressLines[0]).to.include('[fetch] ' + repoBuilder.url)
        expect(progressLines[0]).to.match(/ \[-+\]/)
        expect(progressLines[progressLines.length - 1]).to.match(/ \[#+\]/)
      } finally {
        Object.assign(process.stdout, defaultStdout)
      }
    })

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
        await generateSite(getPlaybook(playbookFile))
        expect(messages).to.have.lengthOf(2)
        expect(messages[0]).to.equal('Site generation complete!\n')
        const expectedFileUri = pathToFileURL(absDestDir)
        expect(messages[1]).to.equal(`Open ${expectedFileUri} in a browser to view your site.\n`)
      } finally {
        Object.assign(process.stdout, defaultStdout)
      }
    })

    it('should report completion message if runtime.quiet is false and IS_TTY is set', async () => {
      playbookSpec.runtime.quiet = false
      env.IS_TTY = 'true'
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const defaultStdout = 'isTTY write'.split(' ').reduce((accum, name) => {
        accum[name] = process.stdout[name]
        return accum
      }, {})
      const messages = []
      try {
        Object.assign(process.stdout, { isTTY: false, write: (line) => messages.push(line) })
        await generateSite(getPlaybook(playbookFile))
        expect(messages).to.have.lengthOf(2)
        expect(messages[0]).to.equal('Site generation complete!\n')
        const expectedFileUri = pathToFileURL(absDestDir)
        expect(messages[1]).to.equal(`Open ${expectedFileUri} in a browser to view your site.\n`)
      } finally {
        Object.assign(process.stdout, defaultStdout)
      }
    })

    it('should append index path to file URI in completion message if start page is set', async () => {
      playbookSpec.site.start_page = 'the-component::the-page.adoc'
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
        await generateSite(getPlaybook(playbookFile))
        expect(messages).to.have.lengthOf(2)
        expect(messages[0]).to.equal('Site generation complete!\n')
        const expectedFileUri = pathToFileURL(ospath.join(absDestDir, 'index.html'))
        expect(messages[1]).to.equal(`Open ${expectedFileUri} in a browser to view your site.\n`)
      } finally {
        Object.assign(process.stdout, defaultStdout)
      }
    })
  })

  // to test:
  // - path to images from topic dir
  // - html URL extension style
  // - ui.yml is not published
})

/* eslint-env mocha */
'use strict'

const { deferExceptions, expect, rmdirSync } = require('../../../test/test-utils')

const fs = require('fs')
const { promises: fsp } = fs
const getCacheDir = require('cache-directory')
const http = require('http')
const loadUi = require('@antora/ui-loader')
const os = require('os')
const ospath = require('path')
const { Transform } = require('stream')
const map = (transform) => new Transform({ objectMode: true, transform })
const vfs = require('vinyl-fs')
const zip = require('gulp-vinyl-zip')

const { UI_CACHE_FOLDER } = require('@antora/ui-loader/lib/constants')
const CACHE_DIR = getCacheDir('antora-test')
const UI_CACHE_DIR = ospath.join(CACHE_DIR, UI_CACHE_FOLDER)
const CWD = process.cwd()
const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')
const WORK_DIR = ospath.join(__dirname, 'work')

describe('loadUi()', () => {
  const expectedFilePaths = [
    'css/one.css',
    'css/two.css',
    'font/Roboto-Medium.ttf',
    'helpers/and.js',
    'helpers/or.js',
    'img/close.svg',
    'img/search.svg',
    'layouts/404.hbs',
    'layouts/default.hbs',
    'partials/footer.hbs',
    'partials/head.hbs',
    'partials/header.hbs',
    'js/01-one.js',
    'js/02-two.js',
  ]

  let server
  let serverRequests

  const prefixPath = (prefix, path_) => [prefix, path_].join(ospath.sep)

  const zipDir = (dir) =>
    new Promise((resolve, reject) =>
      vfs
        .src('**/*', { cwd: dir })
        // NOTE set stable file permissions
        .pipe(
          map((file, _, next) => {
            const stat = file.stat
            if (stat.isFile()) stat.mode = 33188
            else if (stat.isDirectory()) stat.mode = 16877
            next(null, file)
          })
        )
        .pipe(zip.dest(`${dir}.zip`))
        .on('error', reject)
        .on('end', resolve)
    )

  const testAll = (archive, testBlock) => {
    const makeTest = (url) => testBlock({ ui: { bundle: { url } } })
    it('with dot-relative bundle path', () =>
      makeTest(prefixPath('.', ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, archive)))))
    it('with absolute bundle path', () => makeTest(ospath.join(FIXTURES_DIR, archive)))
    it('with remote bundle URI', () => makeTest('http://localhost:1337/' + archive))
  }

  const clean = (fin) => {
    process.chdir(CWD)
    rmdirSync(CACHE_DIR)
    rmdirSync(WORK_DIR)
    if (!fin) {
      fs.mkdirSync(WORK_DIR, { recursive: true })
      process.chdir(WORK_DIR)
    }
  }

  before(() =>
    fsp
      .readdir(FIXTURES_DIR)
      .then((entries) =>
        Promise.all(
          entries
            .filter((entry) => ~entry.indexOf('-ui-bundle') && entry.indexOf('.') < 0)
            .map((it) => zipDir(ospath.join(FIXTURES_DIR, it)))
        )
      )
  )

  beforeEach(() => {
    clean()
    serverRequests = []
    server = http
      .createServer((request, response) => {
        serverRequests.push(request.url)
        if (request.url.startsWith('/redirect?to=')) {
          response.writeHead(301, { Location: `/${request.url.substr(13)}` })
          response.end('<!DOCTYPE html><html><body>Moved.</body></html>', 'utf8')
          return
        }
        fs.readFile(ospath.join(__dirname, 'fixtures', request.url), (err, content) => {
          if (err) {
            response.writeHead(404, { 'Content-Type': 'text/html' })
            response.end('<!DOCTYPE html><html><body>Not Found</body></html>', 'utf8')
          } else {
            response.writeHead(200, { 'Content-Type': 'application/zip' })
            response.end(content)
          }
        })
      })
      .listen(1337)
  })

  after(() =>
    fsp
      .readdir(FIXTURES_DIR)
      .then((entries) =>
        Promise.all(
          entries.filter((entry) => entry.endsWith('.zip')).map((it) => fsp.unlink(ospath.join(FIXTURES_DIR, it)))
        )
      )
  )

  afterEach(() => {
    clean(true)
    server.close()
  })

  describe('should throw error if bundle cannot be found', () => {
    testAll('no-such-bundle.zip', async (playbook) => {
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      if (playbook.ui.bundle.url.startsWith('http://')) {
        const expectedMessage = `Failed to download UI bundle: ${playbook.ui.bundle.url}`
        expect(loadUiDeferred)
          .to.throw(expectedMessage)
          .with.property('stack')
          .that.matches(/Caused by: HTTP.*404/)
      } else {
        const expectedMessage = `UI bundle does not exist: ${playbook.ui.bundle.url}`
        expect(loadUiDeferred).to.throw(expectedMessage)
      }
    })
  })

  describe('should throw error if bundle is not a valid zip file', () => {
    testAll('the-ui-bundle.tar.gz', async (playbook) => {
      const isRemote = playbook.ui.bundle.url.startsWith('http://')
      const expectedMessage = isRemote ? `Invalid UI bundle: ${playbook.ui.bundle.url}` : 'Failed to read UI bundle:'
      expect(await deferExceptions(loadUi, { playbook }))
        .to.throw(expectedMessage)
        .with.property('stack')
        .that.includes('not a valid zip file')
    })
  })

  describe('should load all files in the UI bundle', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
      const relativePaths = files.map((file) => file.relative)
      expect(paths).to.eql(relativePaths)
    })
  })

  describe('should map getAll as alias for getFiles', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      expect(uiCatalog.getAll).to.equal(uiCatalog.getFiles)
      const files = uiCatalog.getAll()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
      const relativePaths = files.map((file) => file.relative)
      expect(paths).to.eql(relativePaths)
    })
  })

  describe('should set stat size on files extracted from UI bundle', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      const files = uiCatalog.getFiles()
      files.forEach((file) => {
        const stat = file.stat
        expect(stat.size).to.be.finite()
        file.path === 'partials/head.hbs' ? expect(stat.size).to.equal(0) : expect(stat.size).to.be.above(0)
      })
    })
  })

  describe('should assign correct file permissions to files extracted from UI bundle', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      const modes = [...new Set(uiCatalog.getFiles().map(({ stat: { mode } }) => mode))]
      expect(modes).to.have.lengthOf(1)
      expect(modes[0]).to.equal(33188)
    })
  })

  describe('should expand local bundle path', () => {
    it('should append unanchored bundle path to cwd', async () => {
      const playbookDir = ospath.join(WORK_DIR, 'some-other-folder')
      const playbook = { dir: playbookDir }
      fs.mkdirSync(playbookDir, { recursive: true })
      const bundleFixture = ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip')
      fs.copyFileSync(bundleFixture, 'the-ui-bundle.zip')
      playbook.ui = { bundle: { url: 'the-ui-bundle.zip' } }
      let uiCatalog
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(() => (uiCatalog = loadUiDeferred())).to.not.throw()
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })

    it('should expand leading . segment in bundle path to playbook dir', async () => {
      const playbook = { dir: WORK_DIR }
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      playbook.ui = {
        bundle: {
          url: prefixPath('.', ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip'))),
        },
      }
      let uiCatalog
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(() => (uiCatalog = loadUiDeferred())).to.not.throw()
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })

    it('should expand leading ~ segment in bundle path to user home', async () => {
      const playbook = {}
      playbook.ui = {
        bundle: {
          url: prefixPath('~', ospath.relative(os.homedir(), ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip'))),
        },
      }
      let uiCatalog
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(() => (uiCatalog = loadUiDeferred())).to.not.throw()
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })

    it('should expand leading ~+ segment in bundle path to cwd', async () => {
      const playbook = { dir: WORK_DIR }
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      playbook.ui = {
        bundle: {
          url: prefixPath('~+', ospath.relative(newWorkDir, ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip'))),
        },
      }
      let uiCatalog
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(() => (uiCatalog = loadUiDeferred())).to.not.throw()
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })
  })

  describe('should locate bundle when cwd and playbook dir are different', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      playbook.dir = WORK_DIR
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      let uiCatalog
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(() => (uiCatalog = loadUiDeferred())).to.not.throw()
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })
  })

  describe('should load all files in the bundle from specified startPath', () => {
    describe('when startPath is /', () => {
      testAll('the-ui-bundle.zip', async (playbook) => {
        playbook.ui.bundle.startPath = '/'
        const uiCatalog = await loadUi({ playbook })
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
      })
    })

    describe('when startPath is absolute', () => {
      testAll('the-ui-bundle-with-start-path.zip', async (playbook) => {
        playbook.ui.bundle.startPath = '/the-ui-bundle'
        const uiCatalog = await loadUi({ playbook })
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
        expect(paths).to.not.include('the-ui-bundle.txt')
      })
    })

    describe('when startPath is relative', () => {
      testAll('the-ui-bundle-with-start-path.zip', async (playbook) => {
        playbook.ui.bundle.startPath = 'the-ui-bundle'
        const uiCatalog = await loadUi({ playbook })
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
        expect(paths).to.not.include('the-ui-bundle.txt')
      })
    })

    describe('when startPath has trailing slash', () => {
      testAll('the-ui-bundle-with-start-path.zip', async (playbook) => {
        playbook.ui.bundle.startPath = 'the-ui-bundle/'
        const uiCatalog = await loadUi({ playbook })
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
        expect(paths).to.not.include('the-ui-bundle.txt')
      })
    })
  })

  describe('should load supplemental files', () => {
    let playbook
    const expectedFilePathsWithSupplemental = [...expectedFilePaths, 'css/extra.css', 'img/icon.png']
    const supplementalFileContents = ['partials/head.hbs', 'css/extra.css', 'img/icon.png'].reduce((accum, path_) => {
      accum[path_] = fs.readFileSync(ospath.join(FIXTURES_DIR, 'supplemental-files', path_))
      return accum
    }, {})

    const verifySupplementalFiles = (uiCatalog, compareBuffers = true, expectedBase = undefined) => {
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePathsWithSupplemental)
      files.forEach((file) => {
        const path_ = file.path
        if (path_ in supplementalFileContents) {
          if (expectedBase) expect(file.base).to.eql(expectedBase)
          if (compareBuffers) {
            expect(file.contents).to.eql(supplementalFileContents[path_])
          } else {
            expect(file.contents.toString()).to.equal(supplementalFileContents[path_].toString())
          }
        }
      })
    }

    beforeEach(() => {
      playbook = { ui: { bundle: { url: ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip') } } }
    })

    it('throws error when directory does not exist', async () => {
      playbook.ui.supplementalFiles = ospath.join(FIXTURES_DIR, 'does-not-exist')
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(loadUiDeferred).to.throw('problem encountered')
    })

    it('from absolute directory', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.ui.supplementalFiles = supplementalFilesAbsDir
      verifySupplementalFiles(await loadUi({ playbook }), true, supplementalFilesAbsDir)
    })

    it('from dot-relative directory', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.ui.supplementalFiles = prefixPath('.', ospath.relative(WORK_DIR, supplementalFilesAbsDir))
      verifySupplementalFiles(await loadUi({ playbook }), true, supplementalFilesAbsDir)
    })

    it('from dot-relative directory when playbook dir does not match cwd', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.dir = WORK_DIR
      playbook.ui.supplementalFiles = prefixPath('.', ospath.relative(WORK_DIR, supplementalFilesAbsDir))
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      let uiCatalog
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(() => (uiCatalog = loadUiDeferred())).to.not.throw()
      verifySupplementalFiles(uiCatalog, true, supplementalFilesAbsDir)
    })

    it('should only use dot file in supplemental UI directory if defined as a static file', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.ui.supplementalFiles = supplementalFilesAbsDir
      const uiConfigFilePath = ospath.join(supplementalFilesAbsDir, 'ui.yml')
      const staticDotfilePath = ospath.join(supplementalFilesAbsDir, '.htaccess')
      const staticDotfileContents = Buffer.from('ErrorDocument 404 /404-fun.html\n')
      try {
        await fsp.writeFile(uiConfigFilePath, 'static_files: [.htaccess]\n')
        await fsp.writeFile(staticDotfilePath, staticDotfileContents)
        const uiCatalog = await loadUi({ playbook })
        const staticFiles = uiCatalog.findByType('static')
        const staticDotfile = staticFiles.find((it) => it.path === '.htaccess')
        expect(staticDotfile).to.exist()
        expect(staticDotfile.contents).to.eql(staticDotfileContents)
        expect(uiCatalog.getFiles().find((it) => it.path === '.hidden-file.txt')).to.be.undefined()
      } finally {
        await fsp.unlink(staticDotfilePath).catch(() => {})
        await fsp.unlink(uiConfigFilePath).catch(() => {})
      }
    })

    it('should use dot file in supplemental UI directory if matched by static file glob', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      const uiConfigFilePath = ospath.join(supplementalFilesAbsDir, 'ui.yml')
      playbook.ui.supplementalFiles = supplementalFilesAbsDir
      const staticDotfileContents = fs.readFileSync(ospath.join(supplementalFilesAbsDir, '.hidden-file.txt'))
      try {
        await fsp.writeFile(uiConfigFilePath, 'static_files: [.h*]\n')
        const uiCatalog = await loadUi({ playbook })
        const staticDotfile = uiCatalog.getFiles().find((it) => it.path === '.hidden-file.txt')
        expect(staticDotfile).to.exist()
        expect(staticDotfile.contents).to.eql(staticDotfileContents)
      } finally {
        await fsp.unlink(uiConfigFilePath).catch(() => {})
      }
    })

    it('skips supplemental files when scan finds no files', async () => {
      const emptyDir = ospath.join(WORK_DIR, 'empty-directory')
      fs.mkdirSync(emptyDir, { recursive: true })
      playbook.ui.supplementalFiles = 'empty-directory'
      const uiCatalog = await loadUi({ playbook })
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })

    it('from files with string contents', async () => {
      playbook.ui.supplementalFiles = [
        {
          path: 'partials/head.hbs',
          contents: supplementalFileContents['partials/head.hbs'].toString(),
        },
        {
          path: 'css/extra.css',
          contents: supplementalFileContents['css/extra.css'].toString(),
        },
        {
          path: 'img/icon.png',
          contents: supplementalFileContents['img/icon.png'].toString(),
        },
      ]
      const uiCatalog = await loadUi({ playbook })
      verifySupplementalFiles(uiCatalog, false)
      const iconFile = uiCatalog.getFiles().find((it) => it.path === 'img/icon.png')
      expect(iconFile.stat.mtime).to.be.undefined()
      expect(iconFile.stat.isFile()).to.be.true()
    })

    it('from file with string contents that does not contain any newline characters', async () => {
      playbook.ui.supplementalFiles = [
        {
          path: 'partials/head.hbs',
          contents: '<meta name="google-site-verification" content="abcdefghijklmnopqrstuvwxyz">',
        },
      ]
      const uiCatalog = await loadUi({ playbook })
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
      const head = files.find((file) => file.path === 'partials/head.hbs')
      expect(head).to.exist()
      expect(head.contents.toString()).to.include('google-site-verification')
    })

    it('throws error when file does not exist', async () => {
      playbook.ui.supplementalFiles = [
        {
          path: 'partials/head.hbs',
          contents: ospath.join(FIXTURES_DIR, 'does-not-exist/head.hbs'),
        },
      ]
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(loadUiDeferred).to.throw('no such file')
    })

    it('from files with absolute paths', async () => {
      playbook.ui.supplementalFiles = [
        {
          path: 'partials/head.hbs',
          contents: ospath.join(FIXTURES_DIR, 'supplemental-files/partials/head.hbs'),
        },
        {
          path: 'css/extra.css',
          contents: ospath.join(FIXTURES_DIR, 'supplemental-files/css/extra.css'),
        },
        {
          path: 'img/icon.png',
          contents: ospath.join(FIXTURES_DIR, 'supplemental-files/img/icon.png'),
        },
      ]
      verifySupplementalFiles(await loadUi({ playbook }))
    })

    it('from files with relative paths', async () => {
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      const supplementalFilesDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.dir = WORK_DIR
      playbook.ui.supplementalFiles = [
        {
          path: 'partials/head.hbs',
          contents: ospath.relative(newWorkDir, ospath.join(supplementalFilesDir, 'partials/head.hbs')),
        },
        {
          path: 'css/extra.css',
          contents: ospath.relative(newWorkDir, ospath.join(supplementalFilesDir, 'css/extra.css')),
        },
        {
          path: 'img/icon.png',
          contents: ospath.relative(newWorkDir, ospath.join(supplementalFilesDir, 'img/icon.png')),
        },
      ]
      verifySupplementalFiles(await loadUi({ playbook }))
    })

    it('from files relative to user home', async () => {
      const supplementalFilesDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.ui.supplementalFiles = ['partials/head.hbs', 'css/extra.css', 'img/icon.png'].map((path_) => ({
        path: path_,
        contents: prefixPath('~', ospath.relative(os.homedir(), ospath.join(supplementalFilesDir, path_))),
      }))
      let uiCatalog
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(() => (uiCatalog = loadUiDeferred())).to.not.throw()
      verifySupplementalFiles(uiCatalog)
    })

    it('from files with dot-relative paths when playbook dir does not match cwd', async () => {
      const supplementalFilesDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.dir = WORK_DIR
      playbook.ui.supplementalFiles = ['partials/head.hbs', 'css/extra.css', 'img/icon.png'].map((path_) => ({
        path: path_,
        contents: prefixPath('.', ospath.relative(WORK_DIR, ospath.join(supplementalFilesDir, path_))),
      }))
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      let uiCatalog
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(() => (uiCatalog = loadUiDeferred())).to.not.throw()
      verifySupplementalFiles(uiCatalog)
    })

    it('skips supplemental files when empty', async () => {
      playbook.ui.supplementalFiles = []
      const uiCatalog = await loadUi({ playbook })
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })

    it('creates empty file when contents of file is not specified', async () => {
      playbook.ui.supplementalFiles = [{ path: 'partials/head.hbs' }]
      const uiCatalog = await loadUi({ playbook })
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
      const head = files.find((file) => file.path === 'partials/head.hbs')
      expect(head).to.exist()
      expect(head.contents.toString()).to.be.empty()
    })

    it('skips entry when path is not specified', async () => {
      playbook.ui.supplementalFiles = [{ contents: 'this file is ignored' }]
      const uiCatalog = await loadUi({ playbook })
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })
  })

  describe('findByType()', () => {
    describe('should discover helpers', () => {
      testAll('the-ui-bundle.zip', async (playbook) => {
        const uiCatalog = await loadUi({ playbook })
        const helpers = uiCatalog.findByType('helper')
        helpers.forEach(({ type }) => expect(type).to.equal('helper'))
        const helperPaths = helpers.map((file) => file.path)
        expect(helperPaths).to.have.members(['helpers/and.js', 'helpers/or.js'])
      })
    })

    describe('should discover layouts', () => {
      testAll('the-ui-bundle.zip', async (playbook) => {
        const uiCatalog = await loadUi({ playbook })
        const layouts = uiCatalog.findByType('layout')
        layouts.forEach(({ type }) => expect(type).to.equal('layout'))
        const layoutPaths = layouts.map((file) => file.path)
        expect(layoutPaths).to.have.members(['layouts/404.hbs', 'layouts/default.hbs'])
      })
    })

    describe('should discover partials', () => {
      testAll('the-ui-bundle.zip', async (playbook) => {
        const uiCatalog = await loadUi({ playbook })
        const partials = uiCatalog.findByType('partial')
        partials.forEach(({ type }) => expect(type).to.equal('partial'))
        const partialPaths = partials.map((file) => file.path)
        expect(partialPaths).to.have.members(['partials/footer.hbs', 'partials/head.hbs', 'partials/header.hbs'])
      })
    })

    describe('should discover assets', () => {
      testAll('the-ui-bundle.zip', async (playbook) => {
        const uiCatalog = await loadUi({ playbook })
        const uiAssets = uiCatalog.findByType('asset')
        uiAssets.forEach(({ type }) => expect(type).to.equal('asset'))
        const uiAssetPaths = uiAssets.map((file) => file.path)
        expect(uiAssetPaths).to.have.members([
          'css/one.css',
          'css/two.css',
          'font/Roboto-Medium.ttf',
          'img/close.svg',
          'img/search.svg',
          'js/01-one.js',
          'js/02-two.js',
        ])
      })
    })

    describe('should differentiate static files from assets', () => {
      testAll('the-ui-bundle-with-static-files.zip', async (playbook) => {
        const uiCatalog = await loadUi({ playbook })
        const filepaths = uiCatalog.getFiles().map((file) => file.path)
        expect(filepaths).to.not.include('ui.yml')
        const uiAssets = uiCatalog.findByType('asset')
        uiAssets.forEach(({ type }) => expect(type).to.equal('asset'))
        const uiAssetPaths = uiAssets.map((file) => file.path)
        expect(uiAssetPaths).to.have.members([
          'css/one.css',
          'css/two.css',
          'fonts/Roboto-Medium.ttf',
          'foo/bar/hello.json',
          'images/close.svg',
          'images/search.svg',
          'scripts/01-one.js',
          'scripts/02-two.js',
        ])
        const staticFiles = uiCatalog.findByType('static')
        staticFiles.forEach(({ type }) => expect(type).to.equal('static'))
        const staticFilePaths = staticFiles.map((file) => file.path)
        expect(staticFilePaths).to.have.members(['foo/two.xml', 'foo/bar/one.xml', 'humans.txt'])
      })
    })

    describe('should discover static files when specified with single glob string', () => {
      testAll('the-ui-bundle-with-static-files-single-glob.zip', async (playbook) => {
        const uiCatalog = await loadUi({ playbook })
        const filepaths = uiCatalog.getFiles().map((file) => file.path)
        expect(filepaths).to.not.include('ui.yml')
        const staticFiles = uiCatalog.findByType('static')
        staticFiles.forEach(({ type }) => expect(type).to.equal('static'))
        const staticFilePaths = staticFiles.map((file) => file.path)
        expect(staticFilePaths).to.have.members(['foo/two.xml', 'foo/bar/one.xml'])
      })
    })
  })

  describe('should not set the out property on helpers', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      const helpers = uiCatalog.findByType('helper')
      helpers.forEach((file) => {
        expect(file).to.not.have.property('out')
      })
    })
  })

  describe('should not set the out property on layouts', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      const layouts = uiCatalog.findByType('layout')
      layouts.forEach((file) => {
        expect(file).to.not.have.property('out')
      })
    })
  })

  describe('should not set the out property on partials', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      const partials = uiCatalog.findByType('partial')
      partials.forEach((file) => {
        expect(file).to.not.have.property('out')
      })
    })
  })

  describe('should set the out property on assets', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      const uiAssets = uiCatalog.findByType('asset')
      uiAssets.forEach((file) => {
        expect(file).to.have.property('out')
      })
      const script = uiAssets.find(({ path: p }) => p === 'js/01-one.js')
      expect(script).to.exist()
      expect(script.out).to.eql({
        dirname: '_/js',
        basename: '01-one.js',
        path: '_/js/01-one.js',
      })
    })
  })

  describe('should set the out property on assets relative to ui.outputDir from playbook', () => {
    describe('when value is relative', () => {
      testAll('the-ui-bundle.zip', async (playbook) => {
        playbook.ui.outputDir = '_ui'
        const uiCatalog = await loadUi({ playbook })
        const uiAssets = uiCatalog.findByType('asset')
        uiAssets.forEach((file) => {
          expect(file).to.have.property('out')
        })
        const script = uiAssets.find(({ path }) => path === 'js/01-one.js')
        expect(script).to.exist()
        expect(script.out).to.eql({
          dirname: '_ui/js',
          basename: '01-one.js',
          path: '_ui/js/01-one.js',
        })
      })
    })

    describe('when value is absolute', () => {
      testAll('the-ui-bundle.zip', async (playbook) => {
        playbook.ui.outputDir = '/_ui'
        const uiCatalog = await loadUi({ playbook })
        const uiAssets = uiCatalog.findByType('asset')
        uiAssets.forEach((file) => {
          expect(file).to.have.property('out')
        })
        const script = uiAssets.find(({ path }) => path === 'js/01-one.js')
        expect(script).to.exist()
        expect(script.out).to.eql({
          dirname: '_ui/js',
          basename: '01-one.js',
          path: '_ui/js/01-one.js',
        })
      })
    })

    describe('when value is undefined fall back to value specified in UI descriptor in bundle', () => {
      testAll('the-ui-bundle-with-output-dir.zip', async (playbook) => {
        const uiCatalog = await loadUi({ playbook })
        const uiAssets = uiCatalog.findByType('asset')
        const css = uiAssets.find(({ path }) => path === 'css/one.css')
        expect(css).to.exist()
        expect(css.out).to.eql({
          dirname: '_ui/css',
          basename: 'one.css',
          path: '_ui/css/one.css',
        })
      })
    })

    describe('even if output dir is defined in the UI descriptor in bundle', () => {
      testAll('the-ui-bundle-with-output-dir.zip', async (playbook) => {
        playbook.ui.outputDir = 'ui'
        const uiCatalog = await loadUi({ playbook })
        const uiAssets = uiCatalog.findByType('asset')
        const css = uiAssets.find(({ path }) => path === 'css/one.css')
        expect(css).to.exist()
        expect(css.out).to.eql({
          dirname: 'ui/css',
          basename: 'one.css',
          path: 'ui/css/one.css',
        })
      })
    })
  })

  describe('should set the out property on static files', () => {
    testAll('the-ui-bundle-with-static-files.zip', async (playbook) => {
      const uiCatalog = await loadUi({ playbook })
      const staticFiles = uiCatalog.findByType('static')
      staticFiles.forEach((file) => {
        expect(file).to.have.property('out')
      })
      const xml = staticFiles.find(({ path }) => path === 'foo/bar/one.xml')
      expect(xml.out).to.eql({
        dirname: 'foo/bar',
        basename: 'one.xml',
        path: 'foo/bar/one.xml',
      })
    })
  })

  it('should throw error if duplicate file is added to UI catalog', async () => {
    const playbook = {
      ui: { bundle: { url: ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip') } },
    }
    const uiCatalog = await loadUi({ playbook })
    expect(() => uiCatalog.addFile({ type: 'asset', path: 'css/one.css' })).to.throw('Duplicate file')
  })

  it('should use remote bundle from cache on subsequent run', async () => {
    const playbook = {
      ui: { bundle: { url: 'http://localhost:1337/the-ui-bundle.zip' } },
    }
    let uiCatalog = await loadUi({ playbook })
    expect(serverRequests).to.have.lengthOf(1)
    expect(serverRequests[0]).to.equal('/the-ui-bundle.zip')
    expect(CACHE_DIR)
      .to.be.a.directory()
      .with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR)
      .to.be.a.directory()
      .and.not.be.empty()
    let paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)

    uiCatalog = await loadUi({ playbook })
    expect(serverRequests).to.have.lengthOf(1)
    paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should not download if fetch option is enabled and bundle is permanent', async () => {
    const playbook = {
      runtime: { fetch: true },
      ui: { bundle: { url: 'http://localhost:1337/the-ui-bundle.zip' } },
    }
    let uiCatalog = await loadUi({ playbook })
    expect(serverRequests).to.have.lengthOf(1)
    expect(serverRequests[0]).to.equal('/the-ui-bundle.zip')
    expect(CACHE_DIR)
      .to.be.a.directory()
      .with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR)
      .to.be.a.directory()
      .and.not.be.empty()
    const paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)

    uiCatalog = await loadUi({ playbook })
    expect(serverRequests).to.have.lengthOf(1)
  })

  it('should download instead of using cache if fetch option is enabled and bundle is a snapshot', async () => {
    const playbook = {
      runtime: { fetch: true },
      ui: { bundle: { url: 'http://localhost:1337/the-ui-bundle.zip', snapshot: true } },
    }
    let uiCatalog = await loadUi({ playbook })
    expect(serverRequests).to.have.lengthOf(1)
    expect(serverRequests[0]).to.equal('/the-ui-bundle.zip')
    expect(CACHE_DIR)
      .to.be.a.directory()
      .with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR)
      .to.be.a.directory()
      .and.not.be.empty()
    let paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)

    uiCatalog = await loadUi({ playbook })
    expect(serverRequests).to.have.lengthOf(2)
    expect(serverRequests[1]).to.equal('/the-ui-bundle.zip')
    paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should follow redirect when fetching remote UI bundle', async () => {
    const playbook = {
      ui: { bundle: { url: 'http://localhost:1337/redirect?to=the-ui-bundle.zip', snapshot: true } },
    }
    const uiCatalog = await loadUi({ playbook })
    expect(serverRequests).to.have.lengthOf(2)
    expect(serverRequests[0]).to.equal('/redirect?to=the-ui-bundle.zip')
    expect(serverRequests[1]).to.equal('/the-ui-bundle.zip')
    const paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should throw error if remote UI bundle cannot be found', async () => {
    const playbook = {
      runtime: { fetch: true },
      ui: { bundle: { url: 'http://localhost:1337/the-ui-bundl.zip', snapshot: true } },
    }
    const loadUiDeferred = await deferExceptions(loadUi, { playbook })
    const expectedMessage = 'Failed to download UI bundle'
    expect(loadUiDeferred).to.throw(expectedMessage)
  })

  it('should cache bundle if a valid zip file', async () => {
    const playbook = {
      ui: { bundle: { url: 'http://localhost:1337/the-ui-bundle.zip' } },
    }
    await loadUi({ playbook })
    expect(CACHE_DIR)
      .to.be.a.directory()
      .with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR)
      .to.be.a.directory()
      .and.not.be.empty()
    const cachedBundleBasename = await fsp.readdir(UI_CACHE_DIR).then((entries) => entries[0])
    const cachedBundlePath = ospath.join(UI_CACHE_DIR, cachedBundleBasename)
    const expectedContents = await fsp.readFile(ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip'))
    const actualContents = await fsp.readFile(cachedBundlePath)
    try {
      expect(actualContents).to.eql(expectedContents)
    } catch (err) {
      // NOTE showing the diff causes mocha to hang
      err.showDiff = false
      throw err
    }
  })

  it('should not cache bundle if not a valid zip file', async () => {
    const playbook = {
      ui: { bundle: { url: 'http://localhost:1337/the-ui-bundle.tar.gz' } },
    }
    expect(await deferExceptions(loadUi, { playbook })).to.throw()
    expect(CACHE_DIR)
      .to.be.a.directory()
      .with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR)
      .to.be.a.directory()
      .and.be.empty()
  })

  it('should throw error if bundle in cache is not a valid zip file', async () => {
    const playbook = {
      ui: { bundle: { url: 'http://localhost:1337/the-ui-bundle.zip' } },
    }
    await loadUi({ playbook })
    expect(CACHE_DIR)
      .to.be.a.directory()
      .with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR)
      .to.be.a.directory()
      .and.not.be.empty()
    const cachedBundleBasename = await fsp.readdir(UI_CACHE_DIR).then((entries) => entries[0])
    const cachedBundlePath = ospath.join(UI_CACHE_DIR, cachedBundleBasename)
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'the-ui-bundle.tar.gz'), cachedBundlePath)

    expect(await deferExceptions(loadUi, { playbook }))
      .to.throw(`Failed to read UI bundle: ${cachedBundlePath}`)
      .with.property('stack')
      .that.includes('not a valid zip file')
  })

  describe('custom cache dir', () => {
    const testCacheDir = async (cacheDir, dir) => {
      const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
      const customUiCacheDir = ospath.join(customCacheDir, UI_CACHE_FOLDER)
      const playbook = {
        dir,
        runtime: { cacheDir },
        ui: { bundle: { url: 'http://localhost:1337/the-ui-bundle.zip' } },
      }
      const uiCatalog = await loadUi({ playbook })
      expect(UI_CACHE_DIR).to.not.be.a.path()
      expect(customCacheDir)
        .to.be.a.directory()
        .with.subDirs([UI_CACHE_FOLDER])
      expect(customUiCacheDir)
        .to.be.a.directory()
        .and.not.be.empty()
      const paths = uiCatalog.getFiles().map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    }

    it('should use custom cache dir with absolute path', async () => {
      await testCacheDir(ospath.join(WORK_DIR, '.antora-cache'))
    })

    it('should use custom cache dir relative to cwd (implicit)', async () => {
      await testCacheDir('.antora-cache')
    })

    it('should use custom cache dir relative to cwd (explicit)', async () => {
      await testCacheDir(ospath.join('~+', '.antora-cache'))
    })

    it('should use custom cache dir relative to directory of playbook file', async () => {
      process.chdir(os.tmpdir())
      await testCacheDir('./.antora-cache', WORK_DIR)
    })

    it('should use custom cache dir relative to user home', async () => {
      process.chdir(os.tmpdir())
      await testCacheDir('~' + ospath.sep + ospath.relative(os.homedir(), ospath.join(WORK_DIR, '.antora-cache')))
    })

    it('should show sensible error message if catch dir cannot be created', async () => {
      const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
      // NOTE: put a file in the location of the cache directory
      await fsp.writeFile(customCacheDir, '')
      const playbook = {
        runtime: { cacheDir: customCacheDir },
        ui: { bundle: { url: 'http://localhost:1337/the-ui-bundle.zip' } },
      }
      const customUiCacheDir = ospath.join(customCacheDir, UI_CACHE_FOLDER)
      const expectedMessage = `Failed to create UI cache directory: ${customUiCacheDir};`
      const loadUiDeferred = await deferExceptions(loadUi, { playbook })
      expect(loadUiDeferred).to.throw(expectedMessage)
    })
  })
})

/* eslint-env mocha */
'use strict'

const {
  closeServers,
  expect,
  loadSslConfig,
  RepositoryBuilder,
  trapAsyncError,
  wipeSync,
  zipDest,
} = require('@antora/test-harness')

const File = require('vinyl')
const fs = require('fs')
const { promises: fsp } = fs
const getCacheDir = require('cache-directory')
const { globStream } = require('fast-glob')
const http = require('http')
const https = require('https')
const loadUi = require('@antora/ui-loader')
const { once } = require('events')
const os = require('os')
const ospath = require('path')
const { pipeline, Transform } = require('stream')
const map = (transform) => new Transform({ objectMode: true, transform })
const net = require('net')

const { UI_CACHE_FOLDER } = require('#constants')
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

  let httpServer
  let httpServerUrl
  let httpsServer
  let httpsServerUrl
  let proxyServer
  let proxyServerUrl
  let serverRequests
  let proxyAuthorizationHeader

  const ssl = loadSslConfig()

  const prefixPath = (prefix, path_) => [prefix, path_].join(ospath.sep)

  const zipDir = (dir) =>
    new Promise((resolve, reject) =>
      pipeline(
        globStream('**/*.*', { braceExpansion: false, cwd: dir, dot: true, onlyFiles: false, unique: false }),
        map((relpath, _, next) => {
          const abspath = ospath.join(dir, relpath)
          fsp.stat(abspath).then((stat) => {
            // NOTE set stable file permissions
            stat.isFile() ? (stat.mode = 33188) : stat.isDirectory() && (stat.mode = 16877)
            const contents = stat.isFile() ? fs.createReadStream(abspath) : undefined
            next(null, new File({ cwd: dir, path: abspath, contents, stat }))
          }, next)
        }),
        zipDest(`${dir}.zip`),
        (err) => (err ? reject(err) : resolve())
      )
    )

  const testAll = (bundle, testBlock) => {
    const isArchive = !!ospath.extname(bundle)
    const createTest = (url) => testBlock({ ui: { bundle: { url } } })
    it(`with dot-relative ${isArchive ? 'bundle' : 'directory'} path`, () =>
      createTest(prefixPath('.', ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, bundle)))))
    it(`with absolute ${isArchive ? 'bundle' : 'directory'} path`, () => createTest(ospath.join(FIXTURES_DIR, bundle)))
    if (isArchive) {
      it('with http bundle URL', () => createTest(httpServerUrl + bundle))
      it('with https bundle URL', () => {
        const env = process.env
        process.env = Object.assign({}, env, { NODE_TLS_REJECT_UNAUTHORIZED: '0' })
        return createTest(httpsServerUrl + bundle).finally(() => (process.env = env))
      })
    }
  }

  const clean = (fin) => {
    process.chdir(CWD)
    wipeSync(CACHE_DIR)
    wipeSync(WORK_DIR)
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
            .filter((entry) => ~entry.indexOf('-ui-bundle') && !ospath.extname(entry))
            .map((it) => zipDir(ospath.join(FIXTURES_DIR, it)))
        )
      )
  )

  beforeEach(() => {
    clean()
    serverRequests = []
    proxyAuthorizationHeader = undefined
    httpServer = http.createServer((request, response) => {
      serverRequests.push(httpServerUrl + request.url.substr(1))
      if (request.url.startsWith('/redirect?to=')) {
        response.writeHead(301, { Location: `/${request.url.substr(13)}` })
        response.end('<!DOCTYPE html><html><body>Moved.</body></html>', 'utf8')
        return
      } else if (request.url === '/hang-up.zip') {
        response.destroy()
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

    httpsServer = https.createServer(ssl, (request, response) => {
      serverRequests.push(httpsServerUrl + request.url.substr(1))
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

    proxyServer = http.createServer().on('connect', (request, clientSocket, head) => {
      serverRequests.push(proxyServerUrl + ' -> ' + request.url)
      proxyAuthorizationHeader = request.headers['proxy-authorization']
      const [host, port = 80] = request.url.split(':', 2)
      const serverSocket = net
        .connect({ port, host }, () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          serverSocket.write(head)
          serverSocket.pipe(clientSocket)
          clientSocket.pipe(serverSocket)
        })
        .on('end', () => clientSocket.destroy())
    })

    return Promise.all([
      once(httpServer.listen(0), 'listening'),
      once(httpsServer.listen(0), 'listening'),
      once(proxyServer.listen(0), 'listening'),
    ]).then(() => {
      httpServerUrl = new URL(`http://localhost:${httpServer.address().port}`).toString()
      httpsServerUrl = new URL(`https://localhost:${httpsServer.address().port}`).toString()
      proxyServerUrl = new URL(`http://localhost:${proxyServer.address().port}`).toString()
    })
  })

  afterEach(async () => {
    await closeServers(httpServer, httpsServer, proxyServer)
    clean(true)
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

  describe('should throw error if bundle cannot be found', () => {
    testAll('no-such-bundle.zip', async (playbook) => {
      const loadUiDeferred = await trapAsyncError(loadUi, playbook)
      if (~playbook.ui.bundle.url.indexOf('://')) {
        const expectedMessage = `Failed to download UI bundle: ${playbook.ui.bundle.url}`
        expect(loadUiDeferred)
          .to.throw(expectedMessage)
          .with.property('stack')
          .that.matches(/Caused by: HTTPError: .*404/)
      } else if (playbook.ui.bundle.url.startsWith('.')) {
        const expectedMessage =
          `UI bundle does not exist: ${ospath.join(FIXTURES_DIR, 'no-such-bundle.zip')} ` +
          `(resolved from url: ${playbook.ui.bundle.url})`
        expect(loadUiDeferred).to.throw(expectedMessage)
      } else {
        const expectedMessage = `UI bundle does not exist: ${playbook.ui.bundle.url}`
        expect(loadUiDeferred).to.throw(expectedMessage)
      }
    })
  })

  describe('should throw error if bundle is not a valid zip file', () => {
    testAll('the-ui-bundle.tar.gz', async (playbook) => {
      const expectedMessage = ~playbook.ui.bundle.url.indexOf('://')
        ? `Invalid UI bundle: ${playbook.ui.bundle.url}`
        : 'Failed to read UI bundle:'
      expect(await trapAsyncError(loadUi, playbook))
        .to.throw(expectedMessage)
        .with.property('stack')
        .that.includes('not a valid zip file')
    })
  })

  describe('should load all files in the UI bundle', () => {
    const testBlock = async (playbook) => {
      const uiCatalog = await loadUi(playbook)
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
      const relativePaths = files.map((file) => file.relative)
      expect(paths).to.eql(relativePaths)
    }
    testAll('the-ui-bundle.zip', testBlock)
    testAll('the-ui-bundle', testBlock)
  })

  describe('should load all files in the UI directory when specified with a trailing slash', () => {
    const testBlock = async (playbook) => {
      const uiCatalog = await loadUi(playbook)
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
      const relativePaths = files.map((file) => file.relative)
      expect(paths).to.eql(relativePaths)
    }
    testAll('the-ui-bundle/', testBlock)
  })

  it('should resolve symbolic links when reading UI from directory', async () => {
    const uiDir = ospath.join(WORK_DIR, 'the-ui-bundle-with-symlinks')
    const cssDir = ospath.join(uiDir, 'css')
    const layoutsDir = ospath.join(uiDir, 'layouts')
    const defaultLayoutFile = ospath.join(layoutsDir, 'default.hbs')
    const defaultLayoutContents = fs.readFileSync(ospath.join(FIXTURES_DIR, 'the-ui-bundle/layouts/default.hbs'))
    fs.mkdirSync(layoutsDir, { recursive: true })
    fs.writeFileSync(defaultLayoutFile, defaultLayoutContents)
    fs.symlinkSync('default.hbs', ospath.join(layoutsDir, '404.hbs'))
    fs.symlinkSync(ospath.relative(uiDir, ospath.join(FIXTURES_DIR, 'the-ui-bundle/css')), cssDir, 'dir')
    const playbook = { ui: { bundle: { url: uiDir } } }
    const uiCatalog = await loadUi(playbook)
    expect(uiCatalog.getFiles()).to.have.lengthOf(4)
    const files = uiCatalog.getFiles().reduce((accum, file) => {
      accum[file.path] = file
      return accum
    }, {})
    expect(Object.keys(files)).to.have.members(['css/one.css', 'css/two.css', 'layouts/default.hbs', 'layouts/404.hbs'])
    expect(files['layouts/404.hbs'].contents).to.eql(defaultLayoutContents)
    expect(files['css/one.css'].contents.toString()).to.include('color: blue')
  })

  it('should throw error if broken symbolic link is detected when reading UI from directory', async () => {
    const uiDir = ospath.join(WORK_DIR, 'the-ui-bundle-with-broken-symlink')
    const layoutsDir = ospath.join(uiDir, 'layouts')
    fs.mkdirSync(layoutsDir, { recursive: true })
    fs.symlinkSync('not-found.hbs', ospath.join(layoutsDir, 'default.hbs'))
    const playbook = { ui: { bundle: { url: uiDir } } }
    const expectedMessage = `Failed to read UI directory: ${uiDir}`
    const expectedCause = `ENOENT: broken symbolic link, ${ospath.join('layouts', 'default.hbs')} -> not-found.hbs`
    expect(await trapAsyncError(loadUi, playbook))
      .to.throw(expectedMessage)
      .with.property('stack')
      .that.includes(expectedCause)
  })

  it('should throw error if symbolic link cycle is detected when reading UI from directory', async () => {
    const uiDir = ospath.join(WORK_DIR, 'the-ui-bundle-with-symlink-cycle')
    const layoutsDir = ospath.join(uiDir, 'layouts')
    fs.mkdirSync(layoutsDir, { recursive: true })
    fs.symlinkSync('main.hbs', ospath.join(layoutsDir, 'default.hbs'))
    fs.symlinkSync('primary.hbs', ospath.join(layoutsDir, 'main.hbs'))
    fs.symlinkSync('default.hbs', ospath.join(layoutsDir, 'primary.hbs'))
    const playbook = { ui: { bundle: { url: uiDir } } }
    const expectedMessage = `Failed to read UI directory: ${uiDir}`
    const expectedCause = `ELOOP: symbolic link cycle, ${ospath.join('layouts', 'default.hbs')} -> main.hbs`
    expect(await trapAsyncError(loadUi, playbook))
      .to.throw(expectedMessage)
      .with.property('stack')
      .that.includes(expectedCause)
  })

  describe('should ignore backup files when reading UI from directory', () => {
    const testBlock = async (playbook) => {
      const uiCatalog = await loadUi(playbook)
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(['css/site.css', 'layouts/default~home.hbs', 'js/site.js'])
      const relativePaths = files.map((file) => file.relative)
      expect(paths).to.eql(relativePaths)
    }
    testAll('the-ui-bundle-with-backup-files', testBlock)
  })

  describe('should map getAll as alias for getFiles', () => {
    testAll('the-ui-bundle.zip', async (playbook) => {
      const uiCatalog = await loadUi(playbook)
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
      const uiCatalog = await loadUi(playbook)
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
      const uiCatalog = await loadUi(playbook)
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
      expect(await trapAsyncError(async () => (uiCatalog = await loadUi(playbook)))).to.not.throw()
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
      expect(await trapAsyncError(async () => (uiCatalog = await loadUi(playbook)))).to.not.throw()
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })

    it('should expand leading ~ segment in bundle path to user home', async () => {
      const playbook = {
        ui: {
          bundle: {
            url: prefixPath('~', ospath.relative(os.homedir(), ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip'))),
          },
        },
      }
      let uiCatalog
      expect(await trapAsyncError(async () => (uiCatalog = await loadUi(playbook)))).to.not.throw()
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
      expect(await trapAsyncError(async () => (uiCatalog = await loadUi(playbook)))).to.not.throw()
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })
  })

  describe('should locate bundle when cwd and playbook dir are different', () => {
    const testBlock = async (playbook) => {
      playbook.dir = WORK_DIR
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      let uiCatalog
      expect(await trapAsyncError(async () => (uiCatalog = await loadUi(playbook)))).to.not.throw()
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    }
    testAll('the-ui-bundle.zip', testBlock)
    testAll('the-ui-bundle', testBlock)
  })

  describe('should load all files in the bundle from specified startPath', () => {
    describe('when startPath is /', () => {
      const testBlock = async (playbook) => {
        playbook.ui.bundle.startPath = '/'
        const uiCatalog = await loadUi(playbook)
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
      }
      testAll('the-ui-bundle.zip', testBlock)
      testAll('the-ui-bundle', testBlock)
    })

    describe('when startPath is empty', () => {
      const testBlock = async (playbook) => {
        playbook.ui.bundle.startPath = ''
        const uiCatalog = await loadUi(playbook)
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
      }
      testAll('the-ui-bundle.zip', testBlock)
      testAll('the-ui-bundle', testBlock)
    })

    describe('when startPath is absolute', () => {
      const testBlock = async (playbook) => {
        playbook.ui.bundle.startPath = '/the-ui-bundle'
        const uiCatalog = await loadUi(playbook)
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
        expect(paths).to.not.include('the-ui-bundle.txt')
      }
      testAll('the-ui-bundle-with-start-path.zip', testBlock)
      testAll('the-ui-bundle-with-start-path', testBlock)
    })

    describe('when startPath is relative', () => {
      const testBlock = async (playbook) => {
        playbook.ui.bundle.startPath = 'the-ui-bundle'
        const uiCatalog = await loadUi(playbook)
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
        expect(paths).to.not.include('the-ui-bundle.txt')
      }
      testAll('the-ui-bundle-with-start-path.zip', testBlock)
      testAll('the-ui-bundle-with-start-path', testBlock)
    })

    describe('when startPath has trailing slash', () => {
      const testBlock = async (playbook) => {
        playbook.ui.bundle.startPath = 'the-ui-bundle/'
        const uiCatalog = await loadUi(playbook)
        const paths = uiCatalog.getFiles().map((file) => file.path)
        expect(paths).to.have.members(expectedFilePaths)
        expect(paths).to.not.include('the-ui-bundle.txt')
      }
      testAll('the-ui-bundle-with-start-path.zip', testBlock)
      testAll('the-ui-bundle-with-start-path', testBlock)
    })
  })

  describe('should load supplemental files', () => {
    let playbook
    const expectedFilePathsWithSupplemental = [...expectedFilePaths, 'css/extra.css', 'img/icon.png'].sort()
    const supplementalFileContents = ['partials/head.hbs', 'css/extra.css', 'img/icon.png'].reduce((accum, path_) => {
      accum[path_] = fs.readFileSync(ospath.join(FIXTURES_DIR, 'supplemental-files', path_))
      return accum
    }, {})

    const verifySupplementalFiles = (uiCatalog, compareBuffers = true, expectedBase = undefined) => {
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths.slice().sort()).to.have.members(expectedFilePathsWithSupplemental)
      files.forEach((file) => {
        const path_ = file.path
        if (path_ in supplementalFileContents) {
          if (expectedBase) expect(file.base).to.equal(expectedBase)
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
      const expectedMessage = `Specified ui.supplemental_files directory does not exist: ${playbook.ui.supplementalFiles}`
      expect(await trapAsyncError(loadUi, playbook)).to.throw(expectedMessage)
    })

    it('from absolute directory', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.ui.supplementalFiles = supplementalFilesAbsDir
      verifySupplementalFiles(await loadUi(playbook), true, supplementalFilesAbsDir)
    })

    it('from dot-relative directory', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.ui.supplementalFiles = prefixPath('.', ospath.relative(WORK_DIR, supplementalFilesAbsDir))
      verifySupplementalFiles(await loadUi(playbook), true, supplementalFilesAbsDir)
    })

    it('from dot-relative directory when playbook dir does not match cwd', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.dir = WORK_DIR
      playbook.ui.supplementalFiles = prefixPath('.', ospath.relative(WORK_DIR, supplementalFilesAbsDir))
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      let uiCatalog
      expect(await trapAsyncError(async () => (uiCatalog = await loadUi(playbook)))).to.not.throw()
      verifySupplementalFiles(uiCatalog, true, supplementalFilesAbsDir)
    })

    it('should throw error if broken symbolic link is detected in supplemental UI directory', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      const newSupplementalFilesAbsDir = ospath.join(WORK_DIR, 'supplemental-files-with-broken-symlink')
      fs.mkdirSync(newSupplementalFilesAbsDir, { recursive: true })
      const supplementalFilesRelDir = ospath.relative(newSupplementalFilesAbsDir, supplementalFilesAbsDir)
      const partialsDir = ospath.join(newSupplementalFilesAbsDir, 'partials')
      const missingIncludesDir = ospath.join(supplementalFilesRelDir, 'includes')
      fs.symlinkSync(missingIncludesDir, partialsDir, 'dir')
      playbook.ui.supplementalFiles = newSupplementalFilesAbsDir
      const expectedMessage = `Failed to read ui.supplemental_files directory: ${newSupplementalFilesAbsDir}`
      const expectedCause = `ENOENT: broken symbolic link, partials -> ${missingIncludesDir}`
      expect(await trapAsyncError(loadUi, playbook))
        .to.throw(expectedMessage)
        .with.property('stack')
        .that.includes(expectedCause)
    })

    it('should throw error if symbolic link cycle is detected in supplemental UI directory', async () => {
      const newSupplementalFilesAbsDir = ospath.join(WORK_DIR, 'supplemental-files-with-symlink-cycle')
      fs.mkdirSync(newSupplementalFilesAbsDir, { recursive: true })
      const partialsDir = ospath.join(newSupplementalFilesAbsDir, 'partials')
      const includesDir = ospath.join(newSupplementalFilesAbsDir, 'includes')
      fs.symlinkSync('includes', partialsDir, 'dir')
      fs.symlinkSync('partials', includesDir, 'dir')
      playbook.ui.supplementalFiles = newSupplementalFilesAbsDir
      const expectedMessage = `Failed to read ui.supplemental_files directory: ${newSupplementalFilesAbsDir}`
      const expectedCause = 'ELOOP: symbolic link cycle, includes -> partials'
      expect(await trapAsyncError(loadUi, playbook))
        .to.throw(expectedMessage)
        .with.property('stack')
        .that.includes(expectedCause)
    })

    it('should read symlinks', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      const newSupplementalFilesAbsDir = ospath.join(WORK_DIR, 'supplemental-files-with-symlinks')
      const supplementalFilesRelDir = ospath.relative(newSupplementalFilesAbsDir, supplementalFilesAbsDir)
      const cssDir = ospath.join(newSupplementalFilesAbsDir, 'css')
      const imgDir = ospath.join(newSupplementalFilesAbsDir, 'img')
      const partialsDir = ospath.join(newSupplementalFilesAbsDir, 'partials')
      fs.mkdirSync(cssDir, { recursive: true })
      fs.mkdirSync(imgDir, { recursive: true })
      fs.symlinkSync(ospath.join('..', supplementalFilesRelDir, 'css/extra.css'), ospath.join(cssDir, 'extra.css'))
      fs.symlinkSync(ospath.join('..', supplementalFilesRelDir, 'img/icon.png'), ospath.join(imgDir, 'icon.png'))
      fs.symlinkSync(ospath.join(supplementalFilesRelDir, 'partials'), partialsDir, 'dir')
      playbook.ui.supplementalFiles = newSupplementalFilesAbsDir
      verifySupplementalFiles(await loadUi(playbook), true, newSupplementalFilesAbsDir)
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
        const uiCatalog = await loadUi(playbook)
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
        const uiCatalog = await loadUi(playbook)
        const staticDotfile = uiCatalog.getFiles().find((it) => it.path === '.hidden-file.txt')
        expect(staticDotfile).to.exist()
        expect(staticDotfile.contents).to.eql(staticDotfileContents)
      } finally {
        await fsp.unlink(uiConfigFilePath).catch(() => {})
      }
    })

    it('should match static files using match patterns', async () => {
      const supplementalFilesAbsDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.ui.supplementalFiles = supplementalFilesAbsDir
      const uiConfigFilePath = ospath.join(supplementalFilesAbsDir, 'ui.yml')
      const staticDotfilePath = ospath.join(supplementalFilesAbsDir, '.htaccess-10')
      const staticDotfileContents = Buffer.from('ErrorDocument 404 /404-fun.html\n')
      try {
        await fsp.writeFile(uiConfigFilePath, 'static_files:\n- .hta+(c)ess{-{8..12..2},}\n')
        await fsp.writeFile(staticDotfilePath, staticDotfileContents)
        const uiCatalog = await loadUi(playbook)
        const staticFiles = uiCatalog.findByType('static')
        const staticDotfile = staticFiles.find((it) => it.path === '.htaccess-10')
        expect(staticDotfile).to.exist()
        expect(staticDotfile.contents).to.eql(staticDotfileContents)
        expect(uiCatalog.getFiles().find((it) => it.path === '.hidden-file.txt')).to.be.undefined()
      } finally {
        await fsp.unlink(staticDotfilePath).catch(() => {})
        await fsp.unlink(uiConfigFilePath).catch(() => {})
      }
    })

    it('skips supplemental files when scan finds no files', async () => {
      const emptyDir = ospath.join(WORK_DIR, 'empty-directory')
      fs.mkdirSync(emptyDir, { recursive: true })
      playbook.ui.supplementalFiles = 'empty-directory'
      const uiCatalog = await loadUi(playbook)
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
      const uiCatalog = await loadUi(playbook)
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
      const uiCatalog = await loadUi(playbook)
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
      const expectedMessage = 'Failed to read ui.supplemental_files entry'
      const expectedCause = 'no such file'
      expect(await trapAsyncError(loadUi, playbook))
        .to.throw(expectedMessage)
        .with.property('stack')
        .that.includes(expectedCause)
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
      verifySupplementalFiles(await loadUi(playbook))
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
      verifySupplementalFiles(await loadUi(playbook))
    })

    it('from files relative to user home', async () => {
      const supplementalFilesDir = ospath.join(FIXTURES_DIR, 'supplemental-files')
      playbook.ui.supplementalFiles = ['partials/head.hbs', 'css/extra.css', 'img/icon.png'].map((path_) => ({
        path: path_,
        contents: prefixPath('~', ospath.relative(os.homedir(), ospath.join(supplementalFilesDir, path_))),
      }))
      let uiCatalog
      expect(await trapAsyncError(async () => (uiCatalog = await loadUi(playbook)))).to.not.throw()
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
      expect(await trapAsyncError(async () => (uiCatalog = await loadUi(playbook)))).to.not.throw()
      verifySupplementalFiles(uiCatalog)
    })

    it('skips supplemental files when empty', async () => {
      playbook.ui.supplementalFiles = []
      const uiCatalog = await loadUi(playbook)
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })

    it('creates empty file when contents of file is not specified', async () => {
      playbook.ui.supplementalFiles = [{ path: 'partials/head.hbs' }]
      const uiCatalog = await loadUi(playbook)
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
      const head = files.find((file) => file.path === 'partials/head.hbs')
      expect(head).to.exist()
      expect(head.contents.toString()).to.be.empty()
    })

    it('skips entry when path is not specified', async () => {
      playbook.ui.supplementalFiles = [{ contents: 'this file is ignored' }]
      const uiCatalog = await loadUi(playbook)
      const files = uiCatalog.getFiles()
      const paths = files.map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    })
  })

  describe('findByType()', () => {
    describe('should discover helpers', () => {
      const testBlock = async (playbook) => {
        const uiCatalog = await loadUi(playbook)
        const helpers = uiCatalog.findByType('helper')
        helpers.forEach(({ type }) => expect(type).to.equal('helper'))
        const helperPaths = helpers.map((file) => file.path)
        expect(helperPaths).to.have.members(['helpers/and.js', 'helpers/or.js'])
      }
      testAll('the-ui-bundle.zip', testBlock)
      testAll('the-ui-bundle', testBlock)
    })

    describe('should discover layouts', () => {
      const testBlock = async (playbook) => {
        const uiCatalog = await loadUi(playbook)
        const layouts = uiCatalog.findByType('layout')
        layouts.forEach(({ type }) => expect(type).to.equal('layout'))
        const layoutPaths = layouts.map((file) => file.path)
        expect(layoutPaths).to.have.members(['layouts/404.hbs', 'layouts/default.hbs'])
      }
      testAll('the-ui-bundle.zip', testBlock)
      testAll('the-ui-bundle', testBlock)
    })

    describe('should discover partials', () => {
      const testBlock = async (playbook) => {
        const uiCatalog = await loadUi(playbook)
        const partials = uiCatalog.findByType('partial')
        partials.forEach(({ type }) => expect(type).to.equal('partial'))
        const partialPaths = partials.map((file) => file.path)
        expect(partialPaths).to.have.members(['partials/footer.hbs', 'partials/head.hbs', 'partials/header.hbs'])
      }
      testAll('the-ui-bundle.zip', testBlock)
      testAll('the-ui-bundle', testBlock)
    })

    describe('should discover assets', () => {
      const testBlock = async (playbook) => {
        const uiCatalog = await loadUi(playbook)
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
      }
      testAll('the-ui-bundle.zip', testBlock)
      testAll('the-ui-bundle', testBlock)
    })

    describe('should differentiate static files from assets', () => {
      const testBlock = async (playbook) => {
        const uiCatalog = await loadUi(playbook)
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
        expect(staticFilePaths).to.have.members(['foo/two.xml', 'foo/bar/one.xml', 'humans.txt', '.nojekyll'])
      }
      testAll('the-ui-bundle-with-static-files.zip', testBlock)
      testAll('the-ui-bundle-with-static-files', testBlock)
    })

    describe('should discover static files when specified with single glob string', () => {
      testAll('the-ui-bundle-with-static-files-single-glob.zip', async (playbook) => {
        const uiCatalog = await loadUi(playbook)
        const filepaths = uiCatalog.getFiles().map((file) => file.path)
        expect(filepaths).to.not.include('ui.yml')
        const staticFiles = uiCatalog.findByType('static')
        staticFiles.forEach(({ type }) => expect(type).to.equal('static'))
        const staticFilePaths = staticFiles.map((file) => file.path)
        expect(staticFilePaths).to.have.members(['foo/two.xml', 'foo/bar/one.xml'])
      })
    })

    describe('should ignore dot files which are not listed as static files', () => {
      const testBlock = async (playbook) => {
        const uiBundleUrl = playbook.ui.bundle.url
        if (!ospath.extname(uiBundleUrl)) {
          // NOTE make sure .git folder is implicitly ignored
          const uiDescContents = (await fsp.readFile(ospath.join(uiBundleUrl, 'ui.yml'), 'utf8')) + '- .git/*\n'
          await new RepositoryBuilder(WORK_DIR, FIXTURES_DIR)
            .init('the-ui-bundle-with-static-files')
            .then((repoBuilder) => repoBuilder.importFilesFromFixture('the-ui-bundle-with-static-files'))
            .then((repoBuilder) => repoBuilder.addToWorktree('ui.yml', uiDescContents))
            .then((repoBuilder) => repoBuilder.commitAll())
            .then((repoBuilder) => {
              playbook.ui.bundle.url =
                uiBundleUrl.charAt() === '.'
                  ? prefixPath('.', ospath.relative(WORK_DIR, repoBuilder.repoPath))
                  : repoBuilder.repoPath
            })
        }
        const uiCatalog = await loadUi(playbook)
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
        expect(staticFilePaths).to.have.members(['foo/two.xml', 'foo/bar/one.xml', 'humans.txt', '.nojekyll'])
      }
      //testAll('the-ui-bundle-with-static-files.zip', testBlock)
      testAll('the-ui-bundle-with-static-files', testBlock)
    })
  })

  describe('should not set the out property on helpers', () => {
    const testBlock = async (playbook) => {
      const uiCatalog = await loadUi(playbook)
      const helpers = uiCatalog.findByType('helper')
      helpers.forEach((file) => {
        expect(file).to.not.have.property('out')
      })
    }
    testAll('the-ui-bundle.zip', testBlock)
    testAll('the-ui-bundle', testBlock)
  })

  describe('should not set the out property on layouts', () => {
    const testBlock = async (playbook) => {
      const uiCatalog = await loadUi(playbook)
      const layouts = uiCatalog.findByType('layout')
      layouts.forEach((file) => {
        expect(file).to.not.have.property('out')
      })
    }
    testAll('the-ui-bundle.zip', testBlock)
    testAll('the-ui-bundle', testBlock)
  })

  describe('should not set the out property on partials', () => {
    const testBlock = async (playbook) => {
      const uiCatalog = await loadUi(playbook)
      const partials = uiCatalog.findByType('partial')
      partials.forEach((file) => {
        expect(file).to.not.have.property('out')
      })
    }
    testAll('the-ui-bundle.zip', testBlock)
    testAll('the-ui-bundle', testBlock)
  })

  describe('should set the out property on assets', () => {
    const testBlock = async (playbook) => {
      const uiCatalog = await loadUi(playbook)
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
    }
    testAll('the-ui-bundle.zip', testBlock)
    testAll('the-ui-bundle', testBlock)
  })

  describe('should set the out property on assets relative to ui.outputDir from playbook', () => {
    describe('when value is relative', () => {
      const testBlock = async (playbook) => {
        playbook.ui.outputDir = '_ui'
        const uiCatalog = await loadUi(playbook)
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
      }
      testAll('the-ui-bundle.zip', testBlock)
      testAll('the-ui-bundle', testBlock)
    })

    describe('when value is absolute', () => {
      const testBlock = async (playbook) => {
        playbook.ui.outputDir = '/_ui'
        const uiCatalog = await loadUi(playbook)
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
      }
      testAll('the-ui-bundle.zip', testBlock)
      testAll('the-ui-bundle', testBlock)
    })

    describe('when value is undefined fall back to value specified in UI descriptor in bundle', () => {
      testAll('the-ui-bundle-with-output-dir.zip', async (playbook) => {
        const uiCatalog = await loadUi(playbook)
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
        const uiCatalog = await loadUi(playbook)
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
      const uiCatalog = await loadUi(playbook)
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
    const uiCatalog = await loadUi(playbook)
    expect(() => uiCatalog.addFile({ type: 'asset', path: 'css/one.css' })).to.throw('Duplicate UI file: css/one.css')
  })

  it('should remove file if found in UI catalog', async () => {
    const playbook = {
      ui: { bundle: { url: ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip') } },
    }
    const uiCatalog = await loadUi(playbook)
    const numFiles = uiCatalog.getFiles().length
    expect(uiCatalog.removeFile({ type: 'asset', path: 'css/one.css' })).to.be.true()
    expect(uiCatalog.getFiles()).to.have.lengthOf(numFiles - 1)
  })

  it('should not remove file not found in UI catalog', async () => {
    const playbook = {
      ui: { bundle: { url: ospath.join(FIXTURES_DIR, 'the-ui-bundle.zip') } },
    }
    const uiCatalog = await loadUi(playbook)
    const numFiles = uiCatalog.getFiles().length
    expect(uiCatalog.removeFile({ type: 'asset', path: 'no-such-file.js' })).to.be.false()
    expect(uiCatalog.getFiles()).to.have.lengthOf(numFiles)
  })

  it('should use remote bundle from cache on subsequent run', async () => {
    const playbook = {
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
    }
    let uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(1)
    expect(serverRequests[0]).to.equal(playbook.ui.bundle.url)
    expect(CACHE_DIR).to.be.a.directory().with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR).to.be.a.directory().and.not.be.empty()
    let paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)

    uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(1)
    paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should not download if fetch option is enabled and bundle is permanent', async () => {
    const playbook = {
      runtime: { fetch: true },
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
    }
    let uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(1)
    expect(serverRequests[0]).to.equal(playbook.ui.bundle.url)
    expect(CACHE_DIR).to.be.a.directory().with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR).to.be.a.directory().and.not.be.empty()
    const paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)

    uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(1)
  })

  it('should download instead of using cache if fetch option is enabled and bundle is a snapshot', async () => {
    const playbook = {
      runtime: { fetch: true },
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip', snapshot: true } },
    }
    let uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(1)
    expect(serverRequests[0]).to.equal(playbook.ui.bundle.url)
    expect(CACHE_DIR).to.be.a.directory().with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR).to.be.a.directory().and.not.be.empty()
    let paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)

    uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(2)
    expect(serverRequests[1]).to.equal(playbook.ui.bundle.url)
    paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should follow redirect when fetching remote UI bundle', async () => {
    const playbook = {
      ui: { bundle: { url: httpServerUrl + 'redirect?to=the-ui-bundle.zip', snapshot: true } },
    }
    const uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(2)
    expect(serverRequests[0]).to.equal(playbook.ui.bundle.url)
    expect(serverRequests[1]).to.equal(httpServerUrl + 'the-ui-bundle.zip')
    const paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should honor http_proxy network setting when fetching bundle over http', async () => {
    const playbook = {
      network: { httpProxy: proxyServerUrl },
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
    }
    const uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(2)
    expect(serverRequests[0]).to.equal(`${proxyServerUrl} -> localhost:${httpServer.address().port}`)
    expect(proxyAuthorizationHeader).to.be.undefined()
    expect(serverRequests[1]).to.equal(playbook.ui.bundle.url)
    const paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should honor https_proxy network setting when fetching bundle over https', async () => {
    const playbook = {
      network: { httpsProxy: proxyServerUrl },
      ui: { bundle: { url: httpsServerUrl + 'the-ui-bundle.zip' } },
    }
    const env = process.env
    try {
      process.env = Object.assign({}, env, { NODE_TLS_REJECT_UNAUTHORIZED: '0' })
      const uiCatalog = await loadUi(playbook)
      expect(serverRequests).to.have.lengthOf(2)
      expect(serverRequests[0]).to.equal(`${proxyServerUrl} -> localhost:${httpsServer.address().port}`)
      expect(proxyAuthorizationHeader).to.be.undefined()
      expect(serverRequests[1]).to.equal(playbook.ui.bundle.url)
      const paths = uiCatalog.getFiles().map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    } finally {
      process.env = env
    }
  })

  it('should not use proxy if http_proxy network setting is specified but URL is excluded by no_proxy setting', async () => {
    const playbook = {
      network: { httpProxy: proxyServerUrl, noProxy: 'example.org,localhost' },
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
    }
    const uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(1)
    expect(serverRequests[0]).to.equal(playbook.ui.bundle.url)
    const paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should not use proxy if http_proxy network setting is specified but no_proxy setting is a wildcard', async () => {
    const playbook = {
      network: { httpProxy: proxyServerUrl, noProxy: '*' },
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
    }
    const uiCatalog = await loadUi(playbook)
    expect(serverRequests).to.have.lengthOf(1)
    expect(serverRequests[0]).to.equal(playbook.ui.bundle.url)
    const paths = uiCatalog.getFiles().map((file) => file.path)
    expect(paths).to.have.members(expectedFilePaths)
  })

  it('should not use proxy if https_proxy network setting is specified but URL is excluded by no_proxy setting', async () => {
    const playbook = {
      network: { httpsProxy: proxyServerUrl, noProxy: 'example.org,localhost' },
      ui: { bundle: { url: httpsServerUrl + 'the-ui-bundle.zip' } },
    }
    const env = process.env
    try {
      process.env = Object.assign({}, env, { NODE_TLS_REJECT_UNAUTHORIZED: '0' })
      const uiCatalog = await loadUi(playbook)
      expect(serverRequests).to.have.lengthOf(1)
      expect(serverRequests[0]).to.equal(playbook.ui.bundle.url)
      const paths = uiCatalog.getFiles().map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    } finally {
      process.env = env
    }
  })

  it('should not use proxy if https_proxy network setting is specified but no_proxy setting is a wildcard', async () => {
    const playbook = {
      network: { httpsProxy: proxyServerUrl, noProxy: '*' },
      ui: { bundle: { url: httpsServerUrl + 'the-ui-bundle.zip' } },
    }
    const env = process.env
    try {
      process.env = Object.assign({}, env, { NODE_TLS_REJECT_UNAUTHORIZED: '0' })
      const uiCatalog = await loadUi(playbook)
      expect(serverRequests).to.have.lengthOf(1)
      expect(serverRequests[0]).to.equal(playbook.ui.bundle.url)
      const paths = uiCatalog.getFiles().map((file) => file.path)
      expect(paths).to.have.members(expectedFilePaths)
    } finally {
      process.env = env
    }
  })

  it('should throw error if remote UI bundle cannot be found', async () => {
    const playbook = {
      runtime: { fetch: true },
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundl.zip', snapshot: true } },
    }
    const expectedMessage = 'Failed to download UI bundle'
    expect(await trapAsyncError(loadUi, playbook)).to.throw(expectedMessage)
  })

  it('should throw error if connection error occurs when retrieving remote UI bundle', async () => {
    const playbook = {
      runtime: { fetch: true },
      ui: { bundle: { url: httpServerUrl + 'hang-up.zip', snapshot: true } },
    }
    const expectedMessage = 'Failed to download UI bundle'
    const err = await trapAsyncError(loadUi, playbook)
    expect(err)
      .to.throw(expectedMessage)
      .with.property('stack')
      .that.matches(/Caused by: Error: socket hang up/)
    expect(err).to.throw(expectedMessage).with.property('recoverable', true)
  })

  it('should throw error if timeout occurs when retrieving remote UI bundle', async () => {
    httpServer.setTimeout(1)
    const playbook = {
      runtime: { fetch: true },
      ui: { bundle: { url: httpServerUrl + 'hang-up.zip', snapshot: true } },
    }
    const expectedMessage = 'Failed to download UI bundle'
    expect(await trapAsyncError(loadUi, playbook))
      .to.throw(expectedMessage)
      .with.property('recoverable', true)
  })

  it('should cache bundle if a valid zip file', async () => {
    const playbook = {
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
    }
    await loadUi(playbook)
    expect(CACHE_DIR).to.be.a.directory().with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR).to.be.a.directory().and.not.be.empty()
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
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.tar.gz' } },
    }
    expect(await trapAsyncError(loadUi, playbook)).to.throw()
    expect(CACHE_DIR).to.be.a.directory().with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR).to.be.a.directory().and.be.empty()
  })

  it('should throw error if bundle in cache is not a valid zip file', async () => {
    const playbook = {
      ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
    }
    await loadUi(playbook)
    expect(CACHE_DIR).to.be.a.directory().with.subDirs([UI_CACHE_FOLDER])
    expect(UI_CACHE_DIR).to.be.a.directory().and.not.be.empty()
    const cachedBundleBasename = await fsp.readdir(UI_CACHE_DIR).then((entries) => entries[0])
    const cachedBundlePath = ospath.join(UI_CACHE_DIR, cachedBundleBasename)
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'the-ui-bundle.tar.gz'), cachedBundlePath)

    expect(await trapAsyncError(loadUi, playbook))
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
        ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
      }
      const uiCatalog = await loadUi(playbook)
      expect(UI_CACHE_DIR).to.not.be.a.path()
      expect(customCacheDir).to.be.a.directory().with.subDirs([UI_CACHE_FOLDER])
      expect(customUiCacheDir).to.be.a.directory().and.not.be.empty()
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

    it('should show sensible error message if cache dir cannot be created', async () => {
      const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
      // NOTE: put a file in the location of the cache directory
      await fsp.writeFile(customCacheDir, '')
      const playbook = {
        runtime: { cacheDir: customCacheDir },
        ui: { bundle: { url: httpServerUrl + 'the-ui-bundle.zip' } },
      }
      const customUiCacheDir = ospath.join(customCacheDir, UI_CACHE_FOLDER)
      const expectedMessage = `Failed to create UI cache directory: ${customUiCacheDir};`
      expect(await trapAsyncError(loadUi, playbook)).to.throw(expectedMessage)
    })
  })
})

/* eslint-env mocha */
'use strict'

const {
  emptyDirSync,
  expect,
  heredoc,
  pathToFileURL,
  trapAsyncError,
  wipeSync,
  zipStream,
} = require('@antora/test-harness')

const CloneableReadable = require('#cloneable-readable')
const cloneable = require('cloneable-readable')
const File = require('vinyl')
const fs = require('fs')
const { promises: fsp } = fs
const os = require('os')
const ospath = require('path')
const { posix: path } = ospath
const publishFiles = require('@antora/file-publisher')
const { PassThrough, pipeline, Writable } = require('stream')
const forEach = (write) => new Writable({ objectMode: true, write })

const CWD = process.cwd()
const { DEFAULT_DEST_FS, DEFAULT_DEST_ARCHIVE } = require('#constants')
const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')
const HTML_RX = /<html>[\S\s]+<\/html>/
//const PROJECT_ROOT_DIR = ospath.join(__dirname, '../../..')
const PROJECT_ROOT_DIR = process.env.npm_config_local_prefix
const TMP_DIR = os.tmpdir()
const WORK_DIR = ospath.join(__dirname, 'work')

describe('publishFiles()', () => {
  let catalogs
  let playbook

  const createFile = (outPath, contents, asVinyl = true) => {
    if (typeof contents === 'string') contents = Buffer.from(contents)
    const file = asVinyl ? new File({ contents }) : { contents }
    if (outPath) file.out = { path: outPath }
    return file
  }

  const generateHtml = (title, content) => heredoc`
    <!DOCTYPE html>
    <html>
    <head>
    <title>${title}</title>
    </head>
    <body>
    <p>${content}</p>
    </body>
    </html>
  `

  const collectFilesFromZip = async (zipFile) =>
    new Promise((resolve, reject, files = []) =>
      pipeline(
        // set strictFileNames to ensure archive was created with posix paths
        zipStream(zipFile, { strictFileNames: true }),
        forEach((file, _, done) => {
          files.push(file)
          if (!file.isStream()) return done()
          const buffer = []
          pipeline(
            file.contents,
            forEach((chunk, _, readDone) => buffer.push(chunk) && readDone()),
            (readErr) => (readErr ? done(readErr) : Object.assign(file, { contents: Buffer.concat(buffer) }) && done())
          )
        }),
        (err) => (err ? reject(err) : resolve(files))
      )
    )

  const verifyArchiveOutput = (destFile) => {
    let absDestFile
    if (ospath.isAbsolute(destFile) || !playbook.dir) {
      absDestFile = destFile
    } else {
      expect(ospath.resolve(destFile)).to.not.be.a.path()
      absDestFile = ospath.resolve(playbook.dir, destFile)
    }
    expect(absDestFile).to.be.a.file().and.not.empty()
    return collectFilesFromZip(absDestFile).then((files) => {
      expect(files).to.have.lengthOf(6)
      const filepaths = files.map((file) => file.path)
      expect(filepaths).to.have.members([
        path.join('the-component', '1.0', 'index.html'),
        path.join('the-component', '1.0', 'the-page.html'),
        path.join('the-component', '1.0', 'the-module', 'index.html'),
        path.join('the-component', '1.0', 'the-module', 'the-page.html'),
        path.join('_', 'css', 'site.css'),
        path.join('_', 'js', 'site.js'),
      ])
      const indexPath = path.join('the-component', '1.0', 'index.html')
      const indexFile = files.find((file) => file.path === indexPath)
      expect(indexFile.contents.toString()).to.match(HTML_RX)
    })
  }

  const verifyFsOutput = (destDir, expectedSubDirs) => {
    let absDestDir
    if (ospath.isAbsolute(destDir) || !playbook.dir) {
      absDestDir = destDir
    } else {
      expect(ospath.resolve(destDir)).to.not.be.a.path()
      absDestDir = ospath.resolve(playbook.dir, destDir)
    }
    expect(absDestDir)
      .to.be.a.directory()
      .with.subDirs(expectedSubDirs || ['_', 'the-component'])
    expect(ospath.join(absDestDir, '_/css/site.css')).to.be.a.file().with.contents('body { color: red; }')
    expect(ospath.join(absDestDir, '_/js/site.js')).to.be.a.file().with.contents(';(function () {})()')
    expect(ospath.join(absDestDir, 'the-component/1.0/index.html')).to.be.a.file().with.contents.that.match(HTML_RX)
    expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html')).to.be.a.file().with.contents.that.match(HTML_RX)
    expect(ospath.join(absDestDir, 'the-component/1.0/the-module/index.html'))
      .to.be.a.file()
      .with.contents.that.match(HTML_RX)
    expect(ospath.join(absDestDir, 'the-component/1.0/the-module/the-page.html'))
      .to.be.a.file()
      .with.contents.that.match(HTML_RX)
  }

  class LazyReadable extends PassThrough {
    constructor (createStream) {
      super()
      this._read = function () {
        delete this._read // restores original method
        createStream.call(this).on('error', this.emit.bind(this, 'error')).pipe(this)
        return this._read.apply(this, arguments)
      }
      this.emit('readable')
    }
  }

  class MultiFileReadStream extends PassThrough {
    constructor (paths) {
      super()
      ;(this.queue = this.createQueue(paths)).next()
    }

    * createQueue (paths) {
      for (const path_ of paths) {
        fs.createReadStream(path_)
          .once('error', (err) => this.destroy(err))
          .once('end', () => this.queue.next())
          .pipe(this, { end: false })
        yield
      }
      this.push(null)
    }
  }

  beforeEach(() => {
    playbook = {
      dir: WORK_DIR,
      output: {
        destinations: [],
      },
    }
    const contentCatalog = {
      getFiles: () => [
        createFile('the-component/1.0/index.html', generateHtml('Index (ROOT)', 'index')),
        createFile('the-component/1.0/the-page.html', generateHtml('The Page (ROOT)', 'the page')),
        createFile('the-component/1.0/the-module/index.html', generateHtml('Index (the-module)', 'index')),
        createFile('the-component/1.0/the-module/the-page.html', generateHtml('The Page (the-module)', 'the page')),
        createFile(undefined, 'included content'),
      ],
    }
    const uiCatalog = {
      getFiles: () => [
        createFile('_/css/site.css', 'body { color: red; }'),
        createFile('_/js/site.js', ';(function () {})()'),
      ],
    }
    catalogs = [contentCatalog, uiCatalog]
    // this sets process.cwd() to a known location, but not otherwise used
    process.chdir(__dirname)
    emptyDirSync(WORK_DIR)
  })

  after(() => {
    process.chdir(CWD)
    wipeSync(WORK_DIR)
  })

  it('should publish site to fs at default path when no destinations are specified', async () => {
    playbook.output.destinations = undefined
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations).to.be.undefined()
    verifyFsOutput(DEFAULT_DEST_FS)
  })

  it('should publish site to fs at dir path when no destinations are specified', async () => {
    playbook.output.dir = './public'
    delete playbook.output.destinations
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations).to.be.undefined()
    verifyFsOutput(playbook.output.dir)
  })

  it('should publish site to fs at default path when no path is specified', async () => {
    playbook.output.destinations.push({ provider: 'fs' })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.be.undefined()
    verifyFsOutput(DEFAULT_DEST_FS)
  })

  it('should wrap value of catalogs argument in an array if not already an array', async () => {
    playbook.output.destinations = undefined
    await publishFiles(playbook, { getFiles: () => catalogs[0].getFiles().concat(catalogs[1].getFiles()) })
    verifyFsOutput(DEFAULT_DEST_FS)
  })

  it('should use deprecated getAll method on catalogs if getFile method is not found', async () => {
    playbook.output.destinations = undefined
    catalogs.forEach((catalog) => {
      catalog.getAll = catalog.getFiles
      delete catalog.getFiles
    })
    await publishFiles(playbook, catalogs)
    verifyFsOutput(DEFAULT_DEST_FS)
  })

  it('should publish site to fs at relative path resolved from playbook dir', async () => {
    const destDir = './path/to/_site'
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(destDir)
  })

  it('should publish site to fs at relative path resolved from cwd if playbook dir not set', async () => {
    process.chdir(WORK_DIR)
    const destDir = './path/to/_site'
    delete playbook.dir
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(destDir)
  })

  it('should publish site to fs at relative path resolved from cwd', async () => {
    const workingDir = ospath.join(WORK_DIR, 'some-other-folder')
    await fsp.mkdir(workingDir, { recursive: true })
    process.chdir(workingDir)
    const destDir = 'path/to/_site'
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(ospath.join('some-other-folder', destDir))
  })

  it('should publish site to fs at path relative to user home', async () => {
    const relDestDir = ospath.relative(os.homedir(), ospath.join(playbook.dir, 'path/to/site'))
    const absDestDir = ospath.join(os.homedir(), relDestDir)
    const destDir = '~' + ospath.sep + relDestDir
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(absDestDir)
  })

  it('should publish site to fs at absolute path', async () => {
    const destDir = ospath.resolve(playbook.dir, '_site')
    expect(ospath.isAbsolute(destDir)).to.be.true()
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(destDir)
  })

  it('should publish site to fs at destination path override', async () => {
    const destDir = './output'
    playbook.output.destinations.push(Object.freeze({ provider: 'fs' }))
    Object.freeze(playbook.output.destinations)
    playbook.output.dir = destDir
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.not.exist()
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    verifyFsOutput(destDir)
  })

  it('should not publish file to fs that has null contents', async () => {
    playbook.output.dir = './public'
    delete playbook.output.destinations
    const contentCatalog = catalogs[0]
    contentCatalog.getFiles = () => [createFile('_attachments/null.yml')]
    await publishFiles(playbook, catalogs)
    expect(ospath.join(playbook.dir, playbook.output.dir)).to.be.a.directory().with.subDirs(['_'])
  })

  it('should publish site to fs at previously published dir path', async () => {
    playbook.output.dir = './public'
    delete playbook.output.destinations
    const contentCatalog = catalogs[0]
    const files = contentCatalog.getFiles()
    const newFile = createFile('other-component/index.html', generateHtml('Other Page', 'original content'))
    files.push(newFile)
    contentCatalog.getFiles = () => files
    await publishFiles(playbook, catalogs)
    verifyFsOutput(playbook.output.dir, ['_', 'the-component', 'other-component'])
    expect(ospath.join(playbook.dir, playbook.output.dir, 'other-component/index.html'))
      .to.be.a.file()
      .with.contents.that.match(/<html>[\S\s]+original content[\S\s]+<\/html>/)
    newFile.contents = Buffer.from(generateHtml('Other Page', 'updated content'))
    await publishFiles(playbook, catalogs)
    verifyFsOutput(playbook.output.dir, ['_', 'the-component', 'other-component'])
    expect(ospath.join(playbook.dir, playbook.output.dir, 'other-component/index.html'))
      .to.be.a.file()
      .with.contents.that.match(/<html>[\S\s]+updated content[\S\s]+<\/html>/)
  })

  it('should throw an error if cannot write to destination path', async () => {
    const destDir = './_site'
    const resolvedDestDir = ospath.resolve(playbook.dir, destDir)
    await fsp.mkdir(ospath.dirname(resolvedDestDir), { recursive: true })
    // NOTE put a file in our way
    await fsp.writeFile(resolvedDestDir, '')
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    expect(await trapAsyncError(publishFiles, playbook, catalogs)).to.throw('mkdir')
  })

  it('should publish a large number of files', async () => {
    const contentCatalog = catalogs[0]
    const files = contentCatalog.getFiles()
    const numPages = 350
    for (let i = 1; i <= numPages; i++) {
      const contents = `<span>page ${i}</span>\n`.repeat(i)
      files.push(createFile('the-component/1.0/page-' + i + '.html', generateHtml('Page ' + i, contents)))
    }
    contentCatalog.getFiles = () => files
    playbook.output.destinations.push({ provider: 'fs' })
    await publishFiles(playbook, catalogs)
    verifyFsOutput(DEFAULT_DEST_FS)
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS, 'the-component/1.0/page-' + numPages + '.html'))
      .to.be.a.file()
      .with.contents.that.match(HTML_RX)
  })

  if (process.platform !== 'win32') {
    it('should sync mode of output file with mode of input file', async () => {
      const contentCatalog = catalogs[0]
      const files = contentCatalog.getFiles()
      const contents664 = 'mode 664\n'
      const file664 = createFile('the-component/1.0/664.html', generateHtml('Mode 664', contents664))
      file664.stat = { mode: parseInt('100664', 8) }
      files.push(file664)
      const contents640 = 'mode 640\n'
      const file640 = createFile('the-component/1.0/640.html', generateHtml('Mode 640', contents640))
      file640.stat = { mode: parseInt('100640', 8) }
      files.push(file640)
      contentCatalog.getFiles = () => files
      playbook.output.destinations.push({ provider: 'fs' })
      await publishFiles(playbook, catalogs)
      verifyFsOutput(DEFAULT_DEST_FS)
      expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS, 'the-component/1.0/664.html'))
        .to.be.a.file()
        .with.contents.that.match(HTML_RX)
      for (const file of files) {
        if (file.stat) {
          const stat = await fsp.stat(ospath.resolve(playbook.dir, DEFAULT_DEST_FS, file.out.path))
          expect(stat.mode).to.equal(parseInt('100' + ospath.basename(file.out.path, '.html'), 8))
        }
      }
    })
  }

  it('should publish site to archive at default path if no path is specified', async () => {
    playbook.output.destinations.push({ provider: 'archive' })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.be.undefined()
    await verifyArchiveOutput(DEFAULT_DEST_ARCHIVE)
  })

  it('should publish site to archive at relative path resolved from playbook dir', async () => {
    const destFile = './path/to/site.zip'
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(destFile)
  })

  it('should publish site to archive at relative path resolved from cwd if playbook dir not set', async () => {
    process.chdir(WORK_DIR)
    const destFile = './path/to/site.zip'
    delete playbook.dir
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(destFile)
  })

  it('should publish site to archive at relative path resolved from cwd', async () => {
    const workingDir = ospath.join(WORK_DIR, 'some-other-folder')
    await fsp.mkdir(workingDir, { recursive: true })
    process.chdir(workingDir)
    const destFile = 'path/to/site.zip'
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(ospath.join('some-other-folder', destFile))
  })

  it('should publish site to archive relative to user home', async () => {
    const relDestFile = ospath.relative(os.homedir(), ospath.join(playbook.dir, 'path/to/site.zip'))
    const absDestFile = ospath.join(os.homedir(), relDestFile)
    const destFile = '~' + ospath.sep + relDestFile
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(absDestFile)
  })

  it('should publish site to archive at absolute path', async () => {
    const destFile = ospath.resolve(playbook.dir, 'path/to/site.zip')
    expect(ospath.isAbsolute(destFile)).to.be.true()
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(destFile)
  })

  it('should overwrite existing file at archive destination path', async () => {
    const destFile = './path/to/site.zip'
    const resolvedDestFile = ospath.resolve(playbook.dir, destFile)
    await fsp.mkdir(ospath.dirname(resolvedDestFile), { recursive: true })
    await fsp.writeFile(resolvedDestFile, 'not a zip file')
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(destFile)
  })

  it('should not publish file to archive that has null contents', async () => {
    const destFile = './path/to/site.zip'
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    const contentCatalog = catalogs[0]
    const files = contentCatalog.getFiles()
    files.push(createFile('_attachments/null.yml'))
    contentCatalog.getFiles = () => files
    await publishFiles(playbook, catalogs)
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(destFile)
  })

  it('should throw an error if cannot write to archive destination path', async () => {
    const destFile = './path/to/site.zip'
    const resolvedDestFile = ospath.resolve(playbook.dir, destFile)
    await fsp.mkdir(ospath.dirname(resolvedDestFile), { recursive: true })
    // NOTE put a directory in our way
    await fsp.mkdir(resolvedDestFile)
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    expect(await trapAsyncError(publishFiles, playbook, catalogs)).to.throw('EISDIR')
  })

  it('should throw an error if cannot create directory for archive destination path', async () => {
    const destFile = './path/to/site.zip'
    const resolvedDestFile = ospath.resolve(playbook.dir, destFile)
    await fsp.mkdir(ospath.dirname(ospath.dirname(resolvedDestFile)), { recursive: true })
    // NOTE put a file in our way
    await fsp.writeFile(ospath.dirname(resolvedDestFile), '')
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    expect(await trapAsyncError(publishFiles, playbook, catalogs)).to.throw('mkdir')
  })

  it('should throw an error if file to publish to archive is invalid', async () => {
    const destFile = './path/to/site.zip'
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    const contentCatalog = catalogs[0]
    const files = contentCatalog.getFiles()
    files[0].stat = { mode: -1 }
    contentCatalog.getFiles = () => files
    expect(await trapAsyncError(publishFiles, playbook, catalogs)).to.throw('invalid mode')
  })

  it('should publish site that contains file with stream', async () => {
    const destDir = './path/to/_site'
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package.json')
    const expectedContents = await fsp.readFile(dataFile, 'utf8')
    catalogs.push({
      getFiles: () => [createFile('data.json', fs.createReadStream(dataFile))],
    })
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishFiles(playbook, catalogs)
    verifyFsOutput(destDir)
    expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
      .to.be.a.file()
      .with.contents(expectedContents)
  })

  it('should publish site that contains file with legacy cloneable stream', async () => {
    const destDir = './path/to/_site'
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package.json')
    const expectedContents = await fsp.readFile(dataFile, 'utf8')
    catalogs.push({
      getFiles: () => [createFile('data.json', cloneable(fs.createReadStream(dataFile)))],
    })
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishFiles(playbook, catalogs)
    verifyFsOutput(destDir)
    expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
      .to.be.a.file()
      .with.contents(expectedContents)
  })

  it('should publish site to multiple fs directories', async () => {
    const destDir1 = './site1'
    const destDir2 = './site2'
    playbook.output.destinations.push({ provider: 'fs', path: destDir1 })
    playbook.output.destinations.push({ provider: 'fs', path: destDir2 })
    await publishFiles(playbook, catalogs)
    verifyFsOutput(destDir1)
    verifyFsOutput(destDir2)
  })

  it('should write entire contents of file with stream in content catalog to all destinations', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    const contentCatalog = catalogs[0]
    const files = contentCatalog.getFiles()
    files.push(createFile('the-component/1.0/_attachments/data.json', fs.createReadStream(dataFile)))
    contentCatalog.getFiles = () => files
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'the-component/1.0/_attachments/data.json'))
        .to.be.a.file()
        .and.equal(dataFile)
    })
  })

  it('should write entire contents of file with stream in site catalog to all destinations', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    catalogs.push({ getFiles: () => [createFile('data.json', fs.createReadStream(dataFile), false)] })
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
        .to.be.a.file()
        .and.equal(dataFile)
    })
  })

  it('should write entire contents of file with cloneable stream in site catalog to all destinations', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    catalogs.push({ getFiles: () => [createFile('data.json', new CloneableReadable(fs.createReadStream(dataFile)))] })
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
        .to.be.a.file()
        .and.equal(dataFile)
    })
  })

  it('should write entire contents of file with legacy cloneable stream in site catalog to all destinations', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    catalogs.push({ getFiles: () => [createFile('data.json', cloneable(fs.createReadStream(dataFile)))] })
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
        .to.be.a.file()
        .and.equal(dataFile)
    })
  })

  it('should write entire contents of file with legacy cloneable and clone stream in site catalog', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDir = './site'
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    const readStream = cloneable(fs.createReadStream(dataFile))
    catalogs.push({
      getFiles: () => [createFile('data.json', readStream), createFile('data-clone.json', readStream.clone())],
    })
    await publishFiles(playbook, catalogs)
    verifyFsOutput(destDir)
    expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
      .to.be.a.file()
      .and.equal(dataFile)
    expect(ospath.resolve(playbook.dir, destDir, 'data-clone.json'))
      .to.be.a.file()
      .and.equal(dataFile)
  })

  it('should write entire contents of file with legacy cloneable and clone stream in site catalog to all destinations', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    const readStream = cloneable(fs.createReadStream(dataFile))
    readStream.setMaxListeners(0)
    catalogs.push({
      getFiles: () => [createFile('data.json', readStream), createFile('data-clone.json', readStream.clone())],
    })
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
        .to.be.a.file()
        .and.equal(dataFile)
      expect(ospath.resolve(playbook.dir, destDir, 'data-clone.json'))
        .to.be.a.file()
        .and.equal(dataFile)
    })
  })

  it('should write entire contents of file with lazy stream in site catalog to all destinations', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    catalogs.push({
      getFiles: () => [createFile('data.json', new LazyReadable(() => fs.createReadStream(dataFile)), false)],
    })
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
        .to.be.a.file()
        .and.equal(dataFile)
    })
  })

  it('should write entire contents of file with multi-file lazy stream in site catalog to all destinations', async () => {
    const dataFileA = ospath.join(PROJECT_ROOT_DIR, 'package.json')
    const dataFileB = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const expectedContents = (await fsp.readFile(dataFileA, 'utf8')) + (await fsp.readFile(dataFileB, 'utf8'))
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    catalogs.push({
      getFiles: () => [
        createFile('data.json', new LazyReadable(() => new MultiFileReadStream([dataFileA, dataFileB])), false),
      ],
    })
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
        .to.be.a.file()
        .with.contents(expectedContents)
    })
  })

  it('should write entire contents of file with stream returned from function in site catalog to all destinations', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    const dataVinylFile = createFile('data.json', null)
    Object.defineProperty(dataVinylFile, 'contents', { get: () => fs.createReadStream(dataFile) })
    const siteCatalog = { getFiles: () => [dataVinylFile] }
    catalogs.push(siteCatalog)
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
        .to.be.a.file()
        .and.equal(dataFile)
    })
  })

  it('should write entire contents of file with lazy stream returned from function in site catalog to all destinations', async () => {
    const dataFile = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
    const destDirs = [1, 2, 3, 4, 5].map((it) => `./site-${it}`)
    destDirs.forEach((destDir) => playbook.output.destinations.push({ provider: 'fs', path: destDir }))
    const createContents = () => new LazyReadable(() => fs.createReadStream(dataFile))
    const dataVinylFile = createFile('data.json', null)
    Object.defineProperty(dataVinylFile, 'contents', { get: () => createContents() })
    const siteCatalog = { getFiles: () => [dataVinylFile] }
    catalogs.push(siteCatalog)
    await publishFiles(playbook, catalogs)
    destDirs.forEach((destDir) => {
      verifyFsOutput(destDir)
      expect(ospath.resolve(playbook.dir, destDir, 'data.json'))
        .to.be.a.file()
        .and.equal(dataFile)
    })
  })

  it('should replace path of first fs destination when destination override is specified', async () => {
    const destDir1 = './build/site1'
    const destDir2 = './build/site2'
    const destDirOverride = './output'
    playbook.output.destinations.push(Object.freeze({ provider: 'fs', path: destDir1 }))
    playbook.output.destinations.push(Object.freeze({ provider: 'fs', path: destDir2 }))
    Object.freeze(playbook.output.destinations)
    playbook.output.dir = destDirOverride
    await publishFiles(playbook, catalogs)
    expect(ospath.resolve(playbook.dir, destDir1)).to.not.be.a.path()
    verifyFsOutput(destDirOverride)
    verifyFsOutput(destDir2)
    expect(playbook.output.destinations[0].path).to.equal(destDir1)
  })

  it('should publish site to multiple archive files', async () => {
    const destFile1 = './site1.zip'
    const destFile2 = './site2.zip'
    playbook.output.destinations.push({ provider: 'archive', path: destFile1 })
    playbook.output.destinations.push({ provider: 'archive', path: destFile2 })
    await publishFiles(playbook, catalogs)
    await verifyArchiveOutput(destFile1)
    await verifyArchiveOutput(destFile2)
  })

  it('should publish site to fs directory and archive file', async () => {
    playbook.output.destinations.push({ provider: 'fs' })
    playbook.output.destinations.push({ provider: 'archive' })
    await publishFiles(playbook, catalogs)
    verifyFsOutput(DEFAULT_DEST_FS)
    await verifyArchiveOutput(DEFAULT_DEST_ARCHIVE)
  })

  it('should not publish site if destinations is empty', async () => {
    await publishFiles(playbook, catalogs)
    expect(playbook.dir).to.be.a.directory().and.be.empty()
  })

  it('should return publish report for each destination', async () => {
    playbook.output.destinations.push({ provider: 'fs' })
    playbook.output.destinations.push({ provider: 'archive' })
    const reports = await publishFiles(playbook, catalogs)
    expect(reports).to.have.lengthOf(2)
    const fsReport = reports.find((report) => report.provider === 'fs')
    expect(fsReport).to.exist()
    const absFsPath = ospath.resolve(playbook.dir, DEFAULT_DEST_FS)
    expect(fsReport).to.include({ path: DEFAULT_DEST_FS, resolvedPath: absFsPath, fileUri: pathToFileURL(absFsPath) })
    const archiveReport = reports.find((report) => report.provider === 'archive')
    expect(archiveReport).to.exist()
    expect(archiveReport).to.include({
      path: DEFAULT_DEST_ARCHIVE,
      resolvedPath: ospath.resolve(playbook.dir, DEFAULT_DEST_ARCHIVE),
    })
    verifyFsOutput(DEFAULT_DEST_FS)
    await verifyArchiveOutput(DEFAULT_DEST_ARCHIVE)
  })

  it('should escape spaces in file URI when publishing site to fs at path that contains spaces', async () => {
    playbook.output.destinations = undefined
    const destDir = './path with spaces'
    playbook.output.dir = destDir
    const reports = await publishFiles(playbook, catalogs)
    expect(reports).to.have.lengthOf(1)
    const fsReport = reports[0]
    expect(fsReport).to.exist()
    const absFsPath = ospath.resolve(playbook.dir, destDir)
    expect(fsReport).to.include({ path: destDir, resolvedPath: absFsPath, fileUri: pathToFileURL(absFsPath) })
    verifyFsOutput(destDir)
  })

  it('should return empty array if site is not published to any destinations', async () => {
    const reports = await publishFiles(playbook, catalogs)
    expect(reports).to.be.empty()
  })

  it('should publish site to fs at destination path override when another destination is specified', async () => {
    const destDir = './output'
    playbook.output.destinations.push(Object.freeze({ provider: 'archive' }))
    Object.freeze(playbook.output.destinations)
    playbook.output.dir = destDir
    await publishFiles(playbook, catalogs)
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    verifyFsOutput(destDir)
    await verifyArchiveOutput(DEFAULT_DEST_ARCHIVE)
    expect(playbook.output.destinations).to.have.lengthOf(1)
  })

  it('should publish site to destination override even when destinations is empty', async () => {
    const destDir = './output'
    Object.freeze(playbook.output.destinations)
    playbook.output.dir = destDir
    await publishFiles(playbook, catalogs)
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    verifyFsOutput(destDir)
    expect(playbook.output.destinations).to.be.empty()
  })

  it('should clean all destinations if clean is set on output', async () => {
    const destDir1 = './site1'
    const destDir2 = './site2'
    const cleanMeFile1 = ospath.resolve(playbook.dir, destDir1, 'clean-me.txt')
    const cleanMeFile2 = ospath.resolve(playbook.dir, destDir2, 'clean-me.txt')
    playbook.output.destinations.push(Object.freeze({ provider: 'fs', path: destDir1 }))
    playbook.output.destinations.push(Object.freeze({ provider: 'fs', path: destDir2 }))
    playbook.output.clean = true
    await fsp.mkdir(ospath.dirname(cleanMeFile1), { recursive: true })
    await fsp.writeFile(cleanMeFile1, 'clean me!')
    await fsp.mkdir(ospath.dirname(cleanMeFile2), { recursive: true })
    await fsp.writeFile(cleanMeFile2, 'clean me!')
    await publishFiles(playbook, catalogs)
    expect(cleanMeFile1).to.not.be.a.path()
    expect(cleanMeFile2).to.not.be.a.path()
    verifyFsOutput(destDir1)
    verifyFsOutput(destDir2)
    expect(playbook.output.destinations[0].clean).to.not.exist()
    expect(playbook.output.destinations[1].clean).to.not.exist()
  })

  it('should clean destinations marked for cleaning', async () => {
    const destDir1 = './site1'
    const destDir2 = './site2'
    const leaveMeFile1 = ospath.resolve(playbook.dir, destDir1, 'leave-me.txt')
    const cleanMeFile2 = ospath.resolve(playbook.dir, destDir2, 'clean-me.txt')
    playbook.output.destinations.push({ provider: 'fs', path: destDir1 })
    playbook.output.destinations.push({ provider: 'fs', path: destDir2, clean: true })
    await fsp.mkdir(ospath.dirname(leaveMeFile1), { recursive: true })
    await fsp.writeFile(leaveMeFile1, 'leave me!')
    await fsp.mkdir(ospath.dirname(cleanMeFile2), { recursive: true })
    await fsp.writeFile(cleanMeFile2, 'leave me!')
    await publishFiles(playbook, catalogs)
    expect(leaveMeFile1).to.be.a.file().with.contents('leave me!')
    expect(cleanMeFile2).to.not.be.a.path()
    verifyFsOutput(destDir1)
    verifyFsOutput(destDir2)
  })

  it('should load custom provider from absolute path', async () => {
    const destFile = './report.txt'
    const absProviderPath = ospath.resolve(playbook.dir, 'reporter-abs.js')
    await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), absProviderPath)
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: absProviderPath, path: destFile })
    await publishFiles(playbook, catalogs)
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    expect(ospath.resolve(playbook.dir, destFile)).to.be.a.file().with.contents('published 6 files for The Site')
  })

  it('should load custom provider from an absolute path outside working directory', async () => {
    const destFile = './report.txt'
    const absProviderPath = ospath.join(TMP_DIR, `reporter-${process.pid}-${Date.now()}.js`)
    try {
      await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
      await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), absProviderPath)
      playbook.site = { title: 'The Site' }
      playbook.output.destinations.push({ provider: absProviderPath, path: destFile })
      await publishFiles(playbook, catalogs)
      expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
      expect(ospath.resolve(playbook.dir, destFile)).to.be.a.file().with.contents('published 6 files for The Site')
    } finally {
      await fsp.unlink(absProviderPath)
    }
  })

  it('should load custom provider from relative path resolved from playbook dir', async () => {
    const destFile = './report.txt'
    const absProviderPath = ospath.resolve(playbook.dir, 'reporter-rel.js')
    await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), absProviderPath)
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: './reporter-rel.js', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    expect(ospath.resolve(playbook.dir, destFile)).to.be.a.file().with.contents('published 6 files for The Site')
  })

  it('should load custom provider from relative path resolved from cwd', async () => {
    process.chdir(WORK_DIR)
    const destFile = 'report.txt'
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), 'reporter-rel.js')
    delete playbook.dir
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: '~+/reporter-rel.js', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(DEFAULT_DEST_FS).to.not.be.a.path()
    expect(destFile).to.be.a.file().with.contents('published 6 files for The Site')
  })

  it('should load custom provider from relative path resolved from cwd when playbook dir not set', async () => {
    process.chdir(WORK_DIR)
    const destFile = './report.txt'
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), 'reporter-rel.js')
    delete playbook.dir
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: './reporter-rel.js', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(DEFAULT_DEST_FS).to.not.be.a.path()
    expect(destFile).to.be.a.file().with.contents('published 6 files for The Site')
  })

  it('should load custom provider from node modules path', async () => {
    const destFile = './report.txt'
    const absProviderPath = ospath.resolve(playbook.dir, 'node_modules/reporter-mod/index.js')
    await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), absProviderPath)
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: 'reporter-mod', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    expect(ospath.resolve(playbook.dir, destFile)).to.be.a.file().with.contents('published 6 files for The Site')
  })

  it('should load custom provider multiple times', async () => {
    const destFile = './report.txt'
    const destFile2 = './report.txt.1'
    const absProviderPath = ospath.resolve(playbook.dir, 'reporter-multi.js')
    await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), absProviderPath)
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: './reporter-multi.js', path: destFile })
    playbook.output.destinations.push({ provider: './reporter-multi', path: destFile })
    await publishFiles(playbook, catalogs)
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    expect(ospath.resolve(playbook.dir, destFile)).to.be.a.file().with.contents('published 6 files for The Site')
    expect(ospath.resolve(playbook.dir, destFile2)).to.be.a.file().with.contents('published 6 files for The Site')
  })

  it('should throw error if destination provider is unsupported', async () => {
    playbook.output.destinations.push({ provider: 'unknown' })
    expect(await trapAsyncError(publishFiles, playbook, catalogs))
      .to.throw(Error, 'Unsupported destination provider: unknown')
      .with.property('stack')
      .that.matches(/^Error: Unsupported destination provider: unknown/)
      .that.matches(/^Caused by: Error: Cannot find module/m)
  })

  it('should throw error if destination provider throws an error with a stack', async () => {
    const absProviderPath = ospath.resolve(playbook.dir, 'provider-not-implemented.js')
    await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
    await fsp.writeFile(absProviderPath, "throw 'not implemented'")
    playbook.output.destinations.push({ provider: './provider-not-implemented.js' })
    expect(await trapAsyncError(publishFiles, playbook, catalogs))
      .to.throw(Error, 'Unsupported destination provider: ./provider-not-implemented.js')
      .with.property('stack')
      .that.matches(/^Error: Unsupported destination provider: \.\/provider-not-implemented\.js/)
      .that.matches(/^Caused by: not implemented/m)
  })
})

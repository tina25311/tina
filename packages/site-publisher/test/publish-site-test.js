/* eslint-env mocha */
'use strict'

const {
  bufferizeContents,
  deferExceptions,
  emptyDirSync,
  expect,
  heredoc,
  rmdirSync,
} = require('../../../test/test-utils')

const File = require('vinyl')
const { promises: fsp } = require('fs')
const os = require('os')
const ospath = require('path')
const publishSite = require('@antora/site-publisher')
const vzip = require('gulp-vinyl-zip')

const CWD = process.cwd()
const { DEFAULT_DEST_FS, DEFAULT_DEST_ARCHIVE } = require('@antora/site-publisher/lib/constants')
const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')
const HTML_RX = /<html>[\S\s]+<\/html>/
const TMP_DIR = os.tmpdir()
const WORK_DIR = ospath.join(__dirname, 'work')

describe('publishSite()', () => {
  let catalogs
  let playbook

  const createFile = (outPath, contents) => {
    const file = new File({ contents: Buffer.from(contents) })
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
    new Promise((resolve, reject) => {
      const files = []
      vzip
        .src(zipFile)
        .pipe(bufferizeContents())
        .on('data', (file) => files.push(file))
        .on('error', reject)
        .on('end', () => resolve(files))
    })

  const verifyArchiveOutput = (destFile) => {
    let absDestFile
    if (ospath.isAbsolute(destFile) || !playbook.dir) {
      absDestFile = destFile
    } else {
      expect(ospath.resolve(destFile)).to.not.be.a.path()
      absDestFile = ospath.resolve(playbook.dir, destFile)
    }
    expect(absDestFile)
      .to.be.a.file()
      .and.not.empty()
    return collectFilesFromZip(absDestFile).then((files) => {
      expect(files).to.have.lengthOf(6)
      const filepaths = files.map((file) => file.path)
      expect(filepaths).to.have.members([
        ospath.join('the-component', '1.0', 'index.html'),
        ospath.join('the-component', '1.0', 'the-page.html'),
        ospath.join('the-component', '1.0', 'the-module', 'index.html'),
        ospath.join('the-component', '1.0', 'the-module', 'the-page.html'),
        ospath.join('_', 'css', 'site.css'),
        ospath.join('_', 'js', 'site.js'),
      ])
      const indexPath = ospath.join('the-component', '1.0', 'index.html')
      const indexFile = files.find((file) => file.path === indexPath)
      expect(indexFile.contents.toString()).to.match(HTML_RX)
    })
  }

  const verifyFsOutput = (destDir) => {
    let absDestDir
    if (ospath.isAbsolute(destDir) || !playbook.dir) {
      absDestDir = destDir
    } else {
      expect(ospath.resolve(destDir)).to.not.be.a.path()
      absDestDir = ospath.resolve(playbook.dir, destDir)
    }
    expect(absDestDir)
      .to.be.a.directory()
      .with.subDirs(['_', 'the-component'])
    expect(ospath.join(absDestDir, '_/css/site.css'))
      .to.be.a.file()
      .with.contents('body { color: red; }')
    expect(ospath.join(absDestDir, '_/js/site.js'))
      .to.be.a.file()
      .with.contents(';(function () {})()')
    expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
      .to.be.a.file()
      .with.contents.that.match(HTML_RX)
    expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html'))
      .to.be.a.file()
      .with.contents.that.match(HTML_RX)
    expect(ospath.join(absDestDir, 'the-component/1.0/the-module/index.html'))
      .to.be.a.file()
      .with.contents.that.match(HTML_RX)
    expect(ospath.join(absDestDir, 'the-component/1.0/the-module/the-page.html'))
      .to.be.a.file()
      .with.contents.that.match(HTML_RX)
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
    rmdirSync(WORK_DIR)
  })

  it('should publish site to fs at default path when no destinations are specified', async () => {
    playbook.output.destinations = undefined
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations).to.be.undefined()
    verifyFsOutput(DEFAULT_DEST_FS)
  })

  it('should publish site to fs at default path when no path is specified', async () => {
    playbook.output.destinations.push({ provider: 'fs' })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.be.undefined()
    verifyFsOutput(DEFAULT_DEST_FS)
  })

  it('should use deprecate getAll method on catalogs if getFile method is not found', async () => {
    playbook.output.destinations = undefined
    catalogs.forEach((catalog) => {
      catalog.getAll = catalog.getFiles
      delete catalog.getFiles
    })
    await publishSite(catalogs, { playbook })
    verifyFsOutput(DEFAULT_DEST_FS)
  })

  it('should publish site to fs at relative path resolved from playbook dir', async () => {
    const destDir = './path/to/_site'
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(destDir)
  })

  it('should publish site to fs at relative path resolved from cwd if playbook dir not set', async () => {
    process.chdir(WORK_DIR)
    const destDir = './path/to/_site'
    delete playbook.dir
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(destDir)
  })

  it('should publish site to fs at relative path resolved from cwd', async () => {
    const workingDir = ospath.join(WORK_DIR, 'some-other-folder')
    await fsp.mkdir(workingDir, { recursive: true })
    process.chdir(workingDir)
    const destDir = 'path/to/_site'
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(ospath.join('some-other-folder', destDir))
  })

  it('should publish site to fs at path relative to user home', async () => {
    const relDestDir = ospath.relative(os.homedir(), ospath.join(playbook.dir, 'path/to/site'))
    const absDestDir = ospath.join(os.homedir(), relDestDir)
    const destDir = '~' + ospath.sep + relDestDir
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(absDestDir)
  })

  it('should publish site to fs at absolute path', async () => {
    const destDir = ospath.resolve(playbook.dir, '_site')
    expect(ospath.isAbsolute(destDir)).to.be.true()
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destDir)
    verifyFsOutput(destDir)
  })

  it('should publish site to fs at destination path override', async () => {
    const destDir = './output'
    playbook.output.destinations.push(Object.freeze({ provider: 'fs' }))
    Object.freeze(playbook.output.destinations)
    playbook.output.dir = destDir
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.not.exist()
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    verifyFsOutput(destDir)
  })

  it('should throw an error if cannot write to destination path', async () => {
    const destDir = './_site'
    const resolvedDestDir = ospath.resolve(playbook.dir, destDir)
    await fsp.mkdir(ospath.dirname(resolvedDestDir), { recursive: true })
    // NOTE put a file in our way
    await fsp.writeFile(resolvedDestDir, '')
    playbook.output.destinations.push({ provider: 'fs', path: destDir })
    const publishSiteDeferred = await deferExceptions(publishSite, catalogs, { playbook })
    expect(publishSiteDeferred).to.throw('mkdir')
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
    await publishSite(catalogs, { playbook })
    verifyFsOutput(DEFAULT_DEST_FS)
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS, 'the-component/1.0/page-' + numPages + '.html'))
      .to.be.a.file()
      .with.contents.that.match(HTML_RX)
  })

  it('should publish site to archive at default path if no path is specified', async () => {
    playbook.output.destinations.push({ provider: 'archive' })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.be.undefined()
    await verifyArchiveOutput(DEFAULT_DEST_ARCHIVE)
  })

  it('should publish site to archive at relative path resolved from playbook dir', async () => {
    const destFile = './path/to/site.zip'
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(destFile)
  })

  it('should publish site to archive at relative path resolved from cwd if playbook dir not set', async () => {
    process.chdir(WORK_DIR)
    const destFile = './path/to/site.zip'
    delete playbook.dir
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(destFile)
  })

  it('should publish site to archive at relative path resolved from cwd', async () => {
    const workingDir = ospath.join(WORK_DIR, 'some-other-folder')
    await fsp.mkdir(workingDir, { recursive: true })
    process.chdir(workingDir)
    const destFile = 'path/to/site.zip'
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(ospath.join('some-other-folder', destFile))
  })

  it('should publish site to archive relative to user home', async () => {
    const relDestFile = ospath.relative(os.homedir(), ospath.join(playbook.dir, 'path/to/site.zip'))
    const absDestFile = ospath.join(os.homedir(), relDestFile)
    const destFile = '~' + ospath.sep + relDestFile
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(absDestFile)
  })

  it('should publish site to archive at absolute path', async () => {
    const destFile = ospath.resolve(playbook.dir, 'path/to/site.zip')
    expect(ospath.isAbsolute(destFile)).to.be.true()
    playbook.output.destinations.push({ provider: 'archive', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(playbook.output.destinations[0].path).to.equal(destFile)
    await verifyArchiveOutput(destFile)
  })

  it('should publish site to multiple fs directories', async () => {
    const destDir1 = './site1'
    const destDir2 = './site2'
    playbook.output.destinations.push({ provider: 'fs', path: destDir1 })
    playbook.output.destinations.push({ provider: 'fs', path: destDir2 })
    await publishSite(catalogs, { playbook })
    verifyFsOutput(destDir1)
    verifyFsOutput(destDir2)
  })

  it('should replace path of first fs destination when destination override is specified', async () => {
    const destDir1 = './build/site1'
    const destDir2 = './build/site2'
    const destDirOverride = './output'
    playbook.output.destinations.push(Object.freeze({ provider: 'fs', path: destDir1 }))
    playbook.output.destinations.push(Object.freeze({ provider: 'fs', path: destDir2 }))
    Object.freeze(playbook.output.destinations)
    playbook.output.dir = destDirOverride
    await publishSite(catalogs, { playbook })
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
    await publishSite(catalogs, { playbook })
    await verifyArchiveOutput(destFile1)
    await verifyArchiveOutput(destFile2)
  })

  it('should publish site to fs directory and archive file', async () => {
    playbook.output.destinations.push({ provider: 'fs' })
    playbook.output.destinations.push({ provider: 'archive' })
    await publishSite(catalogs, { playbook })
    verifyFsOutput(DEFAULT_DEST_FS)
    await verifyArchiveOutput(DEFAULT_DEST_ARCHIVE)
  })

  it('should not publish site if destinations is empty', async () => {
    await publishSite(catalogs, { playbook })
    expect(playbook.dir)
      .to.be.a.directory()
      .and.be.empty()
  })

  it('should return publish report for each destination', async () => {
    playbook.output.destinations.push({ provider: 'fs' })
    playbook.output.destinations.push({ provider: 'archive' })
    const reports = await publishSite(catalogs, { playbook })
    expect(reports).to.have.lengthOf(2)
    const fsReport = reports.find((report) => report.provider === 'fs')
    expect(fsReport).to.exist()
    const absFsPath = ospath.resolve(playbook.dir, DEFAULT_DEST_FS)
    expect(fsReport).to.include({
      path: DEFAULT_DEST_FS,
      resolvedPath: absFsPath,
      fileUri: 'file://' + (ospath.sep === '\\' ? '/' + absFsPath.replace(/\\/g, '/') : absFsPath),
    })
    const archiveReport = reports.find((report) => report.provider === 'archive')
    expect(archiveReport).to.exist()
    expect(archiveReport).to.include({
      path: DEFAULT_DEST_ARCHIVE,
      resolvedPath: ospath.resolve(playbook.dir, DEFAULT_DEST_ARCHIVE),
    })
    verifyFsOutput(DEFAULT_DEST_FS)
    await verifyArchiveOutput(DEFAULT_DEST_ARCHIVE)
  })

  it('should return empty array if site is not published to any destinations', async () => {
    const reports = await publishSite(catalogs, { playbook })
    expect(reports).to.be.empty()
  })

  it('should publish site to fs at destination path override when another destination is specified', async () => {
    const destDir = './output'
    playbook.output.destinations.push(Object.freeze({ provider: 'archive' }))
    Object.freeze(playbook.output.destinations)
    playbook.output.dir = destDir
    await publishSite(catalogs, { playbook })
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    verifyFsOutput(destDir)
    await verifyArchiveOutput(DEFAULT_DEST_ARCHIVE)
    expect(playbook.output.destinations).to.have.lengthOf(1)
  })

  it('should publish site to destination override even when destinations is empty', async () => {
    const destDir = './output'
    Object.freeze(playbook.output.destinations)
    playbook.output.dir = destDir
    await publishSite(catalogs, { playbook })
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
    await publishSite(catalogs, { playbook })
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
    await publishSite(catalogs, { playbook })
    expect(leaveMeFile1)
      .to.be.a.file()
      .with.contents('leave me!')
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
    await publishSite(catalogs, { playbook })
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    expect(ospath.resolve(playbook.dir, destFile))
      .to.be.a.file()
      .with.contents('published 6 files for The Site')
  })

  it('should load custom provider from an absolute path outside working directory', async () => {
    const destFile = './report.txt'
    const absProviderPath = ospath.join(TMP_DIR, `reporter-${process.pid}-${Date.now()}.js`)
    try {
      await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
      await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), absProviderPath)
      playbook.site = { title: 'The Site' }
      playbook.output.destinations.push({ provider: absProviderPath, path: destFile })
      await publishSite(catalogs, { playbook })
      expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
      expect(ospath.resolve(playbook.dir, destFile))
        .to.be.a.file()
        .with.contents('published 6 files for The Site')
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
    playbook.output.destinations.push({ provider: './reporter-rel', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    expect(ospath.resolve(playbook.dir, destFile))
      .to.be.a.file()
      .with.contents('published 6 files for The Site')
  })

  it('should load custom provider from relative path resolved from cwd when playbook dir not set', async () => {
    process.chdir(WORK_DIR)
    const destFile = './report.txt'
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), 'reporter-rel.js')
    delete playbook.dir
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: './reporter-rel.js', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(DEFAULT_DEST_FS).to.not.be.a.path()
    expect(destFile)
      .to.be.a.file()
      .with.contents('published 6 files for The Site')
  })

  it('should load custom provider from node modules path', async () => {
    const destFile = './report.txt'
    const absProviderPath = ospath.resolve(playbook.dir, 'node_modules/reporter-mod/index.js')
    await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), absProviderPath)
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: 'reporter-mod', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    expect(ospath.resolve(playbook.dir, destFile))
      .to.be.a.file()
      .with.contents('published 6 files for The Site')
  })

  it('should load custom provider multiple times', async () => {
    const destFile = './report.txt'
    const destFile2 = './report.txt.1'
    const absProviderPath = ospath.resolve(playbook.dir, 'reporter-multi.js')
    await fsp.mkdir(ospath.dirname(absProviderPath), { recursive: true })
    await fsp.copyFile(ospath.join(FIXTURES_DIR, 'reporter.js'), absProviderPath)
    playbook.site = { title: 'The Site' }
    playbook.output.destinations.push({ provider: './reporter-multi', path: destFile })
    playbook.output.destinations.push({ provider: './reporter-multi', path: destFile })
    await publishSite(catalogs, { playbook })
    expect(ospath.resolve(playbook.dir, DEFAULT_DEST_FS)).to.not.be.a.path()
    expect(ospath.resolve(playbook.dir, destFile))
      .to.be.a.file()
      .with.contents('published 6 files for The Site')
    expect(ospath.resolve(playbook.dir, destFile2))
      .to.be.a.file()
      .with.contents('published 6 files for The Site')
  })

  it('should throw error if destination provider is unsupported', async () => {
    playbook.output.destinations.push({ provider: 'unknown' })
    const publishSiteDeferred = await deferExceptions(publishSite, catalogs, { playbook })
    expect(publishSiteDeferred).to.throw('Unsupported destination provider: unknown')
  })
})

/* eslint-env mocha */
'use strict'

process.env.NODE_ENV = 'test'

const chai = require('chai')
chai.use(require('chai-fs'))
chai.use(require('./chai/cheerio'))
chai.use(require('chai-spies'))
chai.use(require('./chai/end-with'))
chai.use(require('./chai/start-with'))
// dirty-chai must be loaded after the other plugins
// see https://github.com/prodatakey/dirty-chai#plugin-assertions
chai.use(require('dirty-chai'))

const cheerio = require('cheerio')
const fs = require('fs')
const { configureLogger } = require('@antora/logger')
const { Git: GitServer } = require('node-git-server')
const mockContentCatalog = require('./mock-content-catalog')(chai)
const { once } = require('events')
const ospath = require('path')
const { PassThrough, Writable } = require('stream')
const { pathToFileURL: pathToFileURLObject } = require('url')
const yazl = require('yazl')
const yauzl = require('yauzl')
const RepositoryBuilder = require('./repository-builder')
const ZipReadable = require('./zip-readable')

beforeEach(() => configureLogger({ level: 'silent' }))

function captureStandardStream (streamName, fn, transform, isAsync) {
  const stream = process[streamName]
  const streamWrite = stream.write
  const fsWrite = fs.write
  const fsWriteSync = fs.writeSync
  if (!transform) {
    transform = function lines (buffer) {
      return buffer.toString().trim().split('\n')
    }
  }
  const data = []
  const restore = () => {
    if (isAsync) fs.write = fsWrite
    fs.writeSync = fsWriteSync
    stream.write = streamWrite
  }
  try {
    if (isAsync) {
      fs.write = (...[fd, buffer, ...remaining]) => {
        const callback = remaining[remaining.length - 1]
        if (fd === stream.fd) {
          data.push(...transform(buffer))
          return callback(null, buffer.length, buffer)
        }
        return fsWrite(fd, buffer, ...remaining)
      }
    }
    fs.writeSync = (...[fd, buffer, ...remaining]) => {
      if (fd === stream.fd) {
        data.push(...transform(buffer))
        return buffer.length
      }
      return fsWriteSync(fd, buffer, ...remaining)
    }
    stream.write = (buffer) => data.push(...transform(buffer))
    const returnValue = fn()
    if (isAsync) {
      return (returnValue instanceof Promise ? returnValue : Promise.resolve(returnValue))
        .then((resolvedValue) =>
          Object.defineProperty(data, 'withReturnValue', {
            get () {
              return () => ({ [transform.name || 'data']: this, returnValue: resolvedValue })
            },
          })
        )
        .finally(restore)
    }
    return Object.defineProperty(data, 'withReturnValue', {
      get () {
        return () => ({ [transform.name || 'data']: this, returnValue })
      },
    })
  } finally {
    if (!isAsync) restore()
  }
}

const closeServer = (server) => once(server.close() || server, 'close')
const closeServers = (...servers) => Promise.all(servers.map(closeServer))

function unlinkSync (path_) {
  try {
    fs.unlinkSync(path_)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

// Removes the specified directory (including all of its contents) or file.
const wipeSync = (dir) => fs.rmSync(dir, { recursive: true, force: true })

function emptyDirSync (dir) {
  let lst
  try {
    lst = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      fs.mkdirSync(dir, { recursive: true })
      return
    } else if (err.code === 'ENOTDIR') {
      unlinkSync(dir)
      fs.mkdirSync(dir, { recursive: true })
      return
    }
    throw err
  }
  lst.forEach((it) => (it.isDirectory() ? wipeSync(ospath.join(dir, it.name)) : unlinkSync(ospath.join(dir, it.name))))
}

module.exports = {
  captureLog: async (fn) => {
    const messages = []
    configureLogger({
      level: 'all',
      failureLevel: 'all',
      destination: {
        write (messageString) {
          const { time, ...message } = JSON.parse(messageString)
          messages.push(message)
          return messageString.length
        },
      },
    })
    const returnValue = await fn()
    return Object.defineProperty(messages, 'withReturnValue', {
      get () {
        return () => ({ messages: this, returnValue })
      },
    })
  },
  captureLogSync: (fn) => {
    const messages = []
    configureLogger({
      level: 'all',
      failureLevel: 'all',
      destination: {
        write (messageString) {
          const { time, ...message } = JSON.parse(messageString)
          messages.push(message)
          return messageString.length
        },
      },
    })
    const returnValue = fn()
    return Object.defineProperty(messages, 'withReturnValue', {
      get () {
        return () => ({ messages: this, returnValue })
      },
    })
  },
  captureStderr: (fn) =>
    new Promise((resolve, reject) => captureStandardStream('stderr', fn, undefined, true).then(resolve, reject)),
  captureStderrSync: (fn) => captureStandardStream('stderr', fn),
  captureStdout: (fn) =>
    new Promise((resolve, reject) => captureStandardStream('stdout', fn, undefined, true).then(resolve, reject)),
  captureStdoutSync: (fn) => captureStandardStream('stdout', fn),
  captureStdoutLog: (fn) =>
    new Promise((resolve, reject) =>
      captureStandardStream(
        'stdout',
        fn,
        function messages (buffer) {
          const { time, ...message } = JSON.parse(buffer)
          return [message]
        },
        true
      ).then(resolve, reject)
    ),
  captureStdoutLogSync: (fn) =>
    captureStandardStream('stdout', fn, function messages (buffer) {
      const { time, ...message } = JSON.parse(buffer)
      return [message]
    }),
  closeServer,
  closeServers,
  configureLogger,
  emptyDirSync,
  expect: chai.expect,
  GitServer,
  heredoc: (literals, ...values) => {
    const str =
      literals.length > 1
        ? values.reduce((accum, value, idx) => accum + value + literals[idx + 1], literals[0])
        : literals[0]
    const lines = str.trimEnd().split(/^/m)
    if (lines.length > 1) {
      if (lines[0] === '\n') lines.shift()
    } else {
      return str
    }
    const indentRx = /^ +/
    const indentSize = Math.min(...lines.filter((l) => l.startsWith(' ')).map((l) => l.match(indentRx)[0].length))
    return (indentSize ? lines.map((l) => (l.startsWith(' ') ? l.substr(indentSize) : l)) : lines).join('')
  },
  loadHtml: (str) => cheerio.load(str),
  loadSslConfig: () => ({
    cert: fs.readFileSync(ospath.join(__dirname, '..', 'fixtures', 'ssl.cert')),
    key: fs.readFileSync(ospath.join(__dirname, '..', 'fixtures', 'ssl.key')),
  }),
  mockContentCatalog,
  //pathToFileURL: (p) => (posixify ? 'file:///' + posixify(p) : 'file://' + p).replace(/ /g, '%20'),
  pathToFileURL: (p) => pathToFileURLObject(p).href,
  posixify: ospath.sep === '\\' ? (p) => p.replace(/\\/g, '/') : undefined,
  RepositoryBuilder,
  spy: chai.spy,
  toJSON: (obj) => JSON.stringify(obj, null, 2),
  trapAsyncError: (fn, ...args) =>
    fn(...args).then(
      (returnValue) => () => returnValue,
      (err) => () => {
        throw err
      }
    ),
  wipeSync,
  zipDest: (zipPath, zipFile = new yazl.ZipFile(), writeStream) => {
    zipFile.outputStream.pipe((writeStream = fs.createWriteStream(zipPath)))
    return new Writable({
      objectMode: true,
      write: (file, _, done) => {
        const stat = file.stat ? { compress: true, mode: file.stat.mode, mtime: file.stat.mtime } : { compress: true }
        if (file.isStream()) {
          zipFile.addReadStream(file.contents, file.relative, stat)
        } else if (file.isDirectory() && (stat.compress = undefined) == null) {
          zipFile.addEmptyDirectory(file.relative, stat)
        } else {
          zipFile.addBuffer(file.isSymbolic() ? Buffer.from(file.symlink) : file.contents, file.relative, stat)
        }
        done()
      },
      final: (done) => {
        writeStream.on('error', done).on('close', done)
        zipFile.on('error', done).end()
      },
    })
  },
  zipStream: (zipPath, opts = {}) => {
    const result = new PassThrough({ objectMode: true })
    yauzl.open(zipPath, { ...opts, autoClose: true, lazyEntries: true }, (err, zipFile) => {
      if (err) return result.emit('error', err)
      new ZipReadable(zipFile).pipe(result)
    })
    return result
  },
}

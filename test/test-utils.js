'use strict'

process.env.NODE_ENV = 'test'

const chai = require('chai')
const fs = require('fs')
const { Transform } = require('stream')
const map = (transform) => new Transform({ objectMode: true, transform })
const ospath = require('path')
const { removeSync: rimrafSync } = require('fs-extra')
const { configureLogger } = require('@antora/logger')

chai.use(require('chai-fs'))
chai.use(require('chai-cheerio'))
chai.use(require('chai-spies'))
// dirty-chai must be loaded after the other plugins
// see https://github.com/prodatakey/dirty-chai#plugin-assertions
chai.use(require('dirty-chai'))
chai.Assertion.addMethod('endWith', function (expected) {
  const subject = this._obj
  let verdict = false
  if (typeof subject === 'string' && typeof expected === 'string') verdict = subject.endsWith(expected)
  return this.assert(
    verdict,
    'expected #{this} to end with #{exp}',
    'expected #{this} to not end with #{exp}',
    expected,
    undefined
  )
})
chai.Assertion.addMethod('startWith', function (expected) {
  const subject = this._obj
  let verdict = false
  if (typeof subject === 'string' && typeof expected === 'string') verdict = subject.startsWith(expected)
  return this.assert(
    verdict,
    'expected #{this} to start with #{exp}',
    'expected #{this} to not start with #{exp}',
    expected,
    undefined
  )
})

beforeEach(() => configureLogger({ level: 'silent' })) // eslint-disable-line no-undef

function captureStandardStream (streamName, fn, transform, cb) {
  const stream = process[streamName]
  const streamWrite = stream.write
  const fsWrite = fs.write
  const fsWriteSync = fs.writeSync
  if (!transform) {
    transform = function lines (buffer) {
      return buffer
        .toString()
        .trim()
        .split('\n')
    }
  }
  const data = []
  const restore = () => {
    if (cb) fs.write = fsWrite
    fs.writeSync = fsWriteSync
    stream.write = streamWrite
  }
  try {
    if (cb) {
      fs.write = (...[fd, buffer, ...remaining]) => {
        const callback = remaining.pop()
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
    if (cb && returnValue instanceof Promise) {
      return returnValue
        .then((actualReturnValue) =>
          cb(
            null,
            Object.defineProperty(data, 'withReturnValue', {
              get () {
                return () => ({ [transform.name || 'data']: this, returnValue: actualReturnValue })
              },
            })
          )
        )
        .catch(cb)
        .finally(restore)
    } else {
      cb = undefined
    }
    return Object.defineProperty(data, 'withReturnValue', {
      get () {
        return () => ({ [transform.name || 'data']: this, returnValue })
      },
    })
  } finally {
    if (!cb) restore()
  }
}

function unlinkSync (path_) {
  try {
    fs.unlinkSync(path_)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

function rmdirSyncPosix (dir) {
  try {
    const lst = fs.readdirSync(dir, { withFileTypes: true })
    lst.forEach((it) =>
      it.isDirectory() ? rmdirSyncPosix(ospath.join(dir, it.name)) : unlinkSync(ospath.join(dir, it.name))
    )
    fs.rmdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return
    if (err.code === 'ENOTDIR') return unlinkSync(dir)
    throw err
  }
}

function rmdirSyncWindows (dir) {
  // NOTE: Windows requires either rimraf (from fs-extra) or Node 12 to remove a non-empty directory
  rimrafSync(dir)
  //fs.rmdirSync(dir, { recursive: true })
}

// Removes the specified directory (including all of its contents) or file.
// Equivalent to fs.promises.rmdir(dir, { recursive: true }) in Node 12.
const rmdirSync = process.platform === 'win32' ? rmdirSyncWindows : rmdirSyncPosix

function emptyDirSync (dir) {
  let lst
  try {
    lst = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') {
      fs.mkdirSync(dir, { recursive: true })
      return
    }
    if (err.code === 'ENOTDIR') {
      unlinkSync(dir)
      fs.mkdirSync(dir, { recursive: true })
      return
    }
    throw err
  }
  lst.forEach((it) => (it.isDirectory() ? rmdirSync(ospath.join(dir, it.name)) : unlinkSync(ospath.join(dir, it.name))))
}

module.exports = {
  bufferizeContents: () =>
    map((file, enc, next) => {
      if (file.isStream()) {
        const data = []
        const readChunk = (chunk) => data.push(chunk)
        const stream = file.contents
        stream.on('data', readChunk)
        stream.once('end', () => {
          stream.removeListener('data', readChunk)
          file.contents = Buffer.concat(data)
          next(null, file)
        })
      } else {
        next(null, file)
      }
    }),
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
  captureStderrSync: (fn) => captureStandardStream('stderr', fn),
  captureStdout: (fn) =>
    new Promise((resolve, reject) =>
      captureStandardStream('stdout', fn, undefined, (err, result) => (err ? reject(err) : resolve(result)))
    ),
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
        (err, result) => (err ? reject(err) : resolve(result))
      )
    ),
  captureStdoutLogSync: (fn) =>
    captureStandardStream('stdout', fn, function messages (buffer) {
      const { time, ...message } = JSON.parse(buffer)
      return [message]
    }),
  configureLogger,
  deferExceptions: async (fn, ...args) => {
    let deferredFn
    try {
      const result = await fn(...args)
      deferredFn = () => result
    } catch (err) {
      deferredFn = () => {
        throw err
      }
    }
    return deferredFn
  },
  emptyDirSync,
  expect: chai.expect,
  heredoc: (literals, ...values) => {
    const str =
      literals.length > 1
        ? values.reduce((accum, value, idx) => accum + value + literals[idx + 1], literals[0])
        : literals[0]
    const lines = str.trimRight().split(/^/m)
    if (lines.length > 1) {
      if (lines[0] === '\n') lines.shift()
    } else {
      return str
    }
    const indentRx = /^ +/
    const indentSize = Math.min(...lines.filter((l) => l.startsWith(' ')).map((l) => l.match(indentRx)[0].length))
    return (indentSize ? lines.map((l) => (l.startsWith(' ') ? l.substr(indentSize) : l)) : lines).join('')
  },
  loadSslConfig: () => ({
    cert: fs.readFileSync(ospath.join(__dirname, 'ssl.cert')),
    key: fs.readFileSync(ospath.join(__dirname, 'ssl.key')),
  }),
  rmdirSync,
  spy: chai.spy,
  toJSON: (obj) => JSON.stringify(obj, undefined, '  '),
}

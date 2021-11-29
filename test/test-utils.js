'use strict'

process.env.NODE_ENV = 'test'

const chai = require('chai')
const cheerio = require('cheerio')
const fs = require('fs')
const ospath = require('path')
const { configureLogger } = require('@antora/logger')

chai.use(require('chai-fs'))
chai.use(require('./chai-cheerio'))
chai.use(require('chai-spies'))
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
// dirty-chai must be loaded after the other plugins
// see https://github.com/prodatakey/dirty-chai#plugin-assertions
chai.use(require('dirty-chai'))

beforeEach(() => configureLogger({ level: 'silent' })) // eslint-disable-line no-undef

function captureStandardStream (streamName, fn, transform, isAsync) {
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
    if (isAsync) fs.write = fsWrite
    fs.writeSync = fsWriteSync
    stream.write = streamWrite
  }
  try {
    if (isAsync) {
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

function unlinkSync (path_) {
  try {
    fs.unlinkSync(path_)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

// Removes the specified directory (including all of its contents) or file.
const wipeSync = (dir) => fs['rmSync' in fs ? 'rmSync' : 'rmdirSync'](dir, { recursive: true, force: true })

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
  configureLogger,
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
  loadHtml: (str) => cheerio.load(str),
  loadSslConfig: () => ({
    cert: fs.readFileSync(ospath.join(__dirname, 'ssl.cert')),
    key: fs.readFileSync(ospath.join(__dirname, 'ssl.key')),
  }),
  spy: chai.spy,
  toJSON: (obj) => JSON.stringify(obj, undefined, '  '),
  trapAsyncError: (fn, ...args) =>
    fn(...args).then(
      (returnValue) => () => returnValue,
      (err) => () => {
        throw err
      }
    ),
  wipeSync,
}

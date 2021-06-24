/* eslint-env mocha */
'use strict'

const { captureStderrSync, captureStdoutSync, captureStdoutLogSync, expect } = require('../../../test/test-utils')
const Logger = require('@antora/logger')
const { configure, configureLogger, finalizeLogger, get, getLogger } = Logger
const { types } = require('util')

describe('logger', () => {
  const findOwnPropertySymbol = (object, key) => {
    const target = `Symbol(${key})`
    return Object.getOwnPropertySymbols(object).find((it) => it.toString() === target)
  }

  const getStream = (logger) => logger[findOwnPropertySymbol(logger, 'pino.stream')]

  const supportsColor = () => {
    let verdict
    require('pino')({ prettyPrint: true }, { write: (msg) => (verdict = msg.includes('\u001b[39m')) }).info('message')
    return verdict
  }

  describe('configure()', () => {
    const getHooks = (logger) => logger[findOwnPropertySymbol(logger, 'pino.hooks')]

    // NOTE this also verifies that the logger is silent by default in the test suite
    it('should add logging interface to silent logger', () => {
      const logger = get(null) // this gives us access to the current unproxied root logger
      expect(Object.getOwnPropertyNames(logger)).to.include('info')
      expect(logger.level).to.equal('silent')
      expect(logger.levelVal).to.equal(Infinity)
      expect(logger.failureLevel).to.equal('silent')
      expect(logger.failureLevelVal).to.equal(Infinity)
      expect(logger.noop).to.be.true()
      expect(logger.child).to.be.instanceOf(Function)
      expect(logger.bindings()).to.eql({}) // verifies name is not set
      expect(getStream(logger)).to.eql({})
      expect(getHooks(logger).logMethod).to.be.undefined()
    })

    it('should not log messages if logger is silent', () => {
      const logger = get(null) // this gives us access to the current unproxied root logger
      const lines = captureStdoutSync(() => logger.fatal('a tree falling in the forest'))
      expect(lines).to.be.empty()
    })

    it('should configure root logger using default settings', () => {
      ;[configure, configureLogger].forEach((fn) => {
        const logger = fn().get(null)
        expect(logger.level).to.equal('info')
        expect(logger.levelVal).to.equal(30)
        expect(logger.isLevelEnabled('warn')).to.be.true()
        expect(logger.isLevelEnabled('info')).to.be.true()
        expect(logger.isLevelEnabled('debug')).to.be.false()
        expect(logger.failureLevel).to.equal('silent')
        expect(logger.failureLevelVal).to.equal(Infinity)
        expect(logger.noop).to.be.false()
        expect(logger.bindings()).to.eql({ name: 'antora' })
        expect(getStream(logger).constructor.name).to.equal('SonicBoom')
        expect(getHooks(logger).logMethod).to.be.instanceOf(Function)
      })
    })

    it('should reuse previous root logger when configure is called if both new and old are noop', () => {
      const oldLogger = get(null)
      expect(oldLogger.noop).to.be.true()
      const newLogger = configure({ level: 'silent' }).get(null)
      expect(newLogger.noop).to.be.true()
      expect(newLogger).to.equal(oldLogger)
    })

    it('should close previous root logger when configure is called', () => {
      const logger = configure().get(null)
      expect(logger.closed).to.be.undefined()
      expect(logger.level).to.equal('info')
      const newLogger = configure({ level: 'debug' }).get(null)
      expect(newLogger.closed).to.be.undefined()
      expect(newLogger.level).to.equal('debug')
      expect(logger.closed).to.be.true()
    })

    it('should write structured (JSON) log message to stdout by default', () => {
      const logger = configure().get(null)
      expect(getStream(logger).constructor.name).to.equal('SonicBoom')
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.eql({ level: 'info', name: 'antora', msg: 'love is the message' })
    })

    it('should format log level as number of levelFormat is number', () => {
      const logger = configure({ levelFormat: 'number' }).get(null)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.eql({ level: 30, name: 'antora', msg: 'love is the message' })
    })

    it('should configure root logger using specified level', () => {
      const logger = configure({ level: 'debug' }).get(null)
      expect(logger.level).to.equal('debug')
      expect(logger.isLevelEnabled('info')).to.be.true()
      expect(logger.isLevelEnabled('debug')).to.be.true()
      expect(logger.isLevelEnabled('trace')).to.be.false()
    })

    it('should configure root logger as silent if level is unknown', () => {
      const logger = configure({ level: 'superfine' }).get(null)
      expect(logger.level).to.equal('silent')
      expect(logger.levelVal).to.equal(Infinity)
      expect(getStream(logger)).to.eql({})
    })

    it('should configure root logger using minimum level if level is all', () => {
      const logger = configure({ level: 'all' }).get(null)
      expect(logger.level).to.equal('trace')
      expect(logger.isLevelEnabled('trace')).to.be.true()
    })

    it('should configure root logger using specified format', () => {
      const logger = configure({ format: 'pretty' }).get(null)
      const stream = getStream(logger)
      expect(stream.constructor.name).to.not.equal('SonicBoom')
      expect(stream.chindings).to.be.instanceOf(Function)
      const lines = captureStderrSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.not.include('{')
      expect(lines[0]).to.include('INFO (antora): love is the message')
    })

    it('should configure root logger using structured (JSON) format if format is unrecognized', () => {
      const logger = configure({ format: 'structured' }).get(null)
      expect(getStream(logger).constructor.name).to.equal('SonicBoom')
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.include('{')
      expect(lines[0]).to.include('"msg":"love is the message"')
    })
  })

  describe('get()', () => {
    beforeEach(configure)

    // NOTE this test also verifies the behavior of the close function
    it('should create logger with default settings and warn if logger is used before configure() is called', () => {
      Logger.close()
      const messages = captureStdoutLogSync(() => get().info('too soon!'))
      expect(messages).to.have.lengthOf(2)
      expect(messages[0]).to.include({
        level: 'warn',
        msg: 'logger not configured; creating logger with default settings',
      })
      expect(messages[1]).to.include({ level: 'info', msg: 'too soon!' })
    })

    it('should return proxy of the root logger if no name is specified', () => {
      ;[Logger, get, getLogger].forEach((fn) => {
        const logger = fn()
        expect(types.isProxy(logger)).to.be.true()
        expect(logger.bindings()).to.eql({ name: 'antora' })
        expect(logger.info).to.be.instanceOf(Function)
        expect(Object.getOwnPropertyNames(logger)).to.include('info')
      })
    })

    it('should return proxy of the silent root logger if no name is specified', () => {
      configure({ level: 'silent' })
      const logger = get()
      expect(types.isProxy(logger)).to.be.true()
      expect(logger.child).to.be.instanceOf(Function)
      expect(get('foobar').bindings()).to.eql({ name: 'foobar' })
      expect(logger.bindings()).to.eql({})
      expect(getStream(logger)).to.eql({})
      expect(logger.info).to.be.instanceOf(Function)
      expect(Object.getOwnPropertyNames(logger)).to.include('info')
    })

    it('should return proxy of the named logger', () => {
      const logger = get('foobar')
      expect(types.isProxy(logger)).to.be.true()
      expect(logger.bindings()).to.eql({ name: 'foobar' })
    })

    it('should redirect calls to logger to new instance of root logger if root logger is reconfigured', () => {
      const logger = get()
      expect(logger.level).to.equal('info')
      configure({ level: 'debug' })
      expect(logger.level).to.equal('debug')
    })

    it('should redirect calls to logger to new instance of named logger if root logger is reconfigured', () => {
      const logger = get('foobar')
      expect(logger.level).to.equal('info')
      configure({ level: 'debug' })
      expect(logger.level).to.equal('debug')
    })
  })

  describe('object shaping', () => {
    beforeEach(configure)

    it('should not reshape object if file property is missing', () => {
      const logObject = { foo: { bar: 'baz' } }
      const name = 'foobar'
      const logger = get(name)
      const messages = captureStdoutLogSync(() => logger.warn(logObject, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        foo: { bar: 'baz' },
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should reshape the file object from worktree', () => {
      const name = 'foobar'
      const logger = get(name)
      const file = {
        abspath: '/path/to/worktree/modules/ROOT/pages/index.adoc',
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
          url: 'https://git.example.org/repo.git',
          worktree: '/path/to/worktree',
        },
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        file: { path: '/path/to/worktree/modules/ROOT/pages/index.adoc' },
        source: { url: 'https://git.example.org/repo.git', refname: 'main', worktree: '/path/to/worktree' },
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should reshape the file object from ref', () => {
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
          url: 'https://git.example.org/repo.git',
        },
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        file: { path: 'modules/ROOT/pages/index.adoc' },
        source: { url: 'https://git.example.org/repo.git', refname: 'main' },
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should reshape the file object with start path from worktree', () => {
      const name = 'foobar'
      const logger = get(name)
      const file = {
        abspath: '/path/to/worktree/docs/modules/ROOT/pages/index.adoc',
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
          worktree: '/path/to/worktree',
        },
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        file: { path: '/path/to/worktree/docs/modules/ROOT/pages/index.adoc' },
        source: {
          url: 'https://git.example.org/repo.git',
          worktree: '/path/to/worktree',
          refname: 'main',
          startPath: 'docs',
        },
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should reshape the file object with start path from ref', () => {
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
        },
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        file: { path: 'docs/modules/ROOT/pages/index.adoc' },
        source: {
          url: 'https://git.example.org/repo.git',
          refname: 'main',
          startPath: 'docs',
        },
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should add line to reshaped file object if specified', () => {
      const logger = get()
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
        },
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file, line: 9 }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].file.line).to.equal(9)
    })

    it('should reshape each entry in the stack into file and source objects', () => {
      const logger = get()
      const origin = {
        type: 'git',
        refname: 'main',
        startPath: 'docs',
        url: 'https://git.example.org/repo.git',
      }
      const file = { path: 'modules/ROOT/partials/nested-include.adoc', origin }
      const stack = [
        {
          file: { path: 'modules/ROOT/partials/include.adoc', origin },
          line: 5,
        },
        {
          file: { path: 'modules/ROOT/pages/index.adoc', origin },
          line: 20,
        },
      ]
      const messages = captureStdoutLogSync(() => logger.warn({ file, line: 9, stack }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name: 'antora',
        file: { path: 'docs/modules/ROOT/partials/nested-include.adoc', line: 9 },
        source: {
          url: 'https://git.example.org/repo.git',
          refname: 'main',
          startPath: 'docs',
        },
        stack: [
          {
            file: { path: 'docs/modules/ROOT/partials/include.adoc', line: 5 },
            source: {
              url: 'https://git.example.org/repo.git',
              refname: 'main',
              startPath: 'docs',
            },
          },
          {
            file: { path: 'docs/modules/ROOT/pages/index.adoc', line: 20 },
            source: {
              url: 'https://git.example.org/repo.git',
              refname: 'main',
              startPath: 'docs',
            },
          },
        ],
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })
  })

  describe('pretty print', () => {
    it('should write pretty log message to stderr when format is pretty', () => {
      const logger = configure({ format: 'pretty' }).get()
      const lines = captureStderrSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const expectedLine = /^\[.+\] INFO \(antora\): love is the message$/
      expect(lines[0]).to.match(expectedLine)
    })

    if (supportsColor()) {
      it('should colorize pretty log message if supported by environment', () => {
        const nodeEnv = process.env.NODE_ENV
        try {
          delete process.env.NODE_ENV
          const logger = configure({ format: 'pretty' }).get()
          const lines = captureStderrSync(() => logger.info('love is the message'))
          expect(lines).to.have.lengthOf(1)
          const expectedLine = '\u001b[32mINFO\u001b[39m (antora): \u001b[36mlove is the message\u001b[39m'
          expect(lines[0]).to.include(expectedLine)
        } finally {
          process.env.NODE_ENV = nodeEnv
        }
      })
    }

    it('should ignore levelFormat setting when format is pretty', () => {
      const logger = configure({ format: 'pretty', levelFormat: 'number' }).get()
      const lines = captureStderrSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const expectedLine = /^\[.+\] INFO \(antora\): love is the message$/
      expect(lines[0]).to.match(expectedLine)
    })

    // NOTE this test verifies the proxy intercepts property assignments
    it('should retain level set on named logger', () => {
      configure({ level: 'warn' })
      const logger = get('name-of-logger')
      logger.level = 'info'
      expect(logger.level).to.equal('info')
      const messages = captureStdoutLogSync(() => logger.info('love is the message'))
      expect(messages).to.have.lengthOf(1)
      const data = messages[0]
      expect(data.level).to.equal('info')
      expect(data.name).to.equal('name-of-logger')
    })

    // NOTE this test verifies the proxy intercepts property assignments
    it('should retain name of logger in message after logger is reconfigured', () => {
      configure()
      const name = 'name-of-logger'
      const logger = get(name)
      ;['json', 'pretty', 'json', 'pretty'].forEach((format) => {
        configure({ format })
        if (format === 'pretty') {
          const lines = captureStderrSync(() => logger.info('love is the message'))
          expect(lines).to.have.lengthOf(1)
          expect(lines[0]).to.include(` (${name}):`)
        } else {
          const messages = captureStdoutLogSync(() => logger.info('love is the message'))
          expect(messages).to.have.lengthOf(1)
          expect(messages[0].name).to.equal(name)
        }
      })
    })

    it('should print file object without line number on a single line', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[1]).to.equal('    file: docs/modules/ROOT/pages/index.adoc')
    })

    it('should print file object and line number on a single line', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file, line: 9 }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[1]).to.equal('    file: docs/modules/ROOT/pages/index.adoc:9')
    })

    it('should print source object from ref on a single line', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
          url: 'https://git.example.org/repo.git',
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[2]).to.equal('    source: https://git.example.org/repo.git (refname: main)')
    })

    it('should print source object with start path from ref on a single line', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[2]).to.equal('    source: https://git.example.org/repo.git (refname: main, start path: docs)')
    })

    it('should print source object from worktree on a single line', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        abspath: '/path/to/worktree/modules/ROOT/pages/index.adoc',
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
          url: 'https://git.example.org/repo.git',
          worktree: '/path/to/worktree',
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[2]).to.equal('    source: /path/to/worktree (refname: main <worktree>)')
    })

    it('should print source object with start path from worktree on a single line', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        abspath: '/path/to/worktree/docs/modules/ROOT/pages/index.adoc',
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
          worktree: '/path/to/worktree',
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[2]).to.equal('    source: /path/to/worktree (refname: main <worktree>, start path: docs)')
    })

    it('should print <unknown> if source does not define a url', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[2]).to.equal('    source: <unknown> (refname: main)')
    })

    it('should show file and source for each entry in stack that comes from a unique source', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/partials/nested-include.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: 'docs',
          url: 'https://git.example.org/repo-c.git',
        },
      }
      const stack = [
        {
          file: {
            path: 'modules/ROOT/partials/include.adoc',
            origin: {
              type: 'git',
              refname: 'main',
              startPath: 'docs',
              url: 'https://git.example.org/repo-b.git',
            },
          },
          line: 5,
        },
        {
          file: {
            path: 'modules/ROOT/pages/index.adoc',
            origin: {
              type: 'git',
              refname: 'main',
              startPath: 'docs',
              url: 'https://git.example.org/repo-a.git',
              worktree: '/path/to/repo-a',
            },
          },
          line: 20,
        },
      ]
      const lines = captureStderrSync(() => logger.warn({ file, line: 9, stack }, 'something is out of place'))
      expect(lines).to.have.lengthOf(8)
      expect(lines[4]).to.equal('        file: docs/modules/ROOT/partials/include.adoc:5')
      expect(lines[5]).to.equal('        source: https://git.example.org/repo-b.git (refname: main, start path: docs)')
      expect(lines[6]).to.equal('        file: docs/modules/ROOT/pages/index.adoc:20')
      expect(lines[7]).to.equal('        source: /path/to/repo-a (refname: main <worktree>, start path: docs)')
    })

    it('should show file and source for each entry in stack that comes from a unique source with no start path', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/partials/nested-include.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
          url: 'https://git.example.org/repo-c.git',
        },
      }
      const stack = [
        {
          file: {
            path: 'modules/ROOT/partials/include.adoc',
            origin: {
              type: 'git',
              refname: 'main',
              startPath: '',
              url: 'https://git.example.org/repo-b.git',
            },
          },
          line: 5,
        },
        {
          file: {
            path: 'modules/ROOT/pages/index.adoc',
            origin: {
              type: 'git',
              refname: 'main',
              startPath: '',
              url: 'https://git.example.org/repo-a.git',
              worktree: '/path/to/repo-a',
            },
          },
          line: 20,
        },
      ]
      const lines = captureStderrSync(() => logger.warn({ file, line: 9, stack }, 'something is out of place'))
      expect(lines).to.have.lengthOf(8)
      expect(lines[4]).to.equal('        file: modules/ROOT/partials/include.adoc:5')
      expect(lines[5]).to.equal('        source: https://git.example.org/repo-b.git (refname: main)')
      expect(lines[6]).to.equal('        file: modules/ROOT/pages/index.adoc:20')
      expect(lines[7]).to.equal('        source: /path/to/repo-a (refname: main <worktree>)')
    })

    it('should not show source if same as previous source reported', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const origin = {
        type: 'git',
        refname: 'main',
        startPath: 'docs',
        url: 'https://git.example.org/repo.git',
      }
      const file = { path: 'modules/ROOT/partials/nested-include.adoc', origin }
      const stack = [
        {
          file: { path: 'modules/ROOT/partials/include.adoc', origin },
          line: 5,
        },
        {
          file: { path: 'modules/ROOT/pages/index.adoc', origin },
          line: 20,
        },
      ]
      const lines = captureStderrSync(() => logger.warn({ file, line: 9, stack }, 'something is out of place'))
      expect(lines).to.have.lengthOf(6)
      expect(lines[4]).to.equal('        file: docs/modules/ROOT/partials/include.adoc:5')
      expect(lines[5]).to.equal('        file: docs/modules/ROOT/pages/index.adoc:20')
    })

    it('should show source again if different from previous source', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const sharedOrigin = {
        type: 'git',
        refname: 'main',
        startPath: 'docs',
        url: 'https://git.example.org/repo-c.git',
      }
      const file = {
        path: 'modules/ROOT/partials/nested-include.adoc',
        origin: sharedOrigin,
      }
      const stack = [
        {
          file: {
            path: 'modules/ROOT/partials/include.adoc',
            origin: sharedOrigin,
          },
          line: 5,
        },
        {
          file: {
            path: 'modules/ROOT/pages/index.adoc',
            origin: {
              type: 'git',
              refname: 'main',
              startPath: 'docs',
              url: 'https://git.example.org/repo-2.git',
            },
          },
          line: 20,
        },
      ]
      const lines = captureStderrSync(() => logger.warn({ file, line: 9, stack }, 'something is out of place'))
      expect(lines).to.have.lengthOf(7)
      expect(lines[4]).to.equal('        file: docs/modules/ROOT/partials/include.adoc:5')
      expect(lines[5]).to.equal('        file: docs/modules/ROOT/pages/index.adoc:20')
      expect(lines[6]).to.equal('        source: https://git.example.org/repo-2.git (refname: main, start path: docs)')
    })

    it('should print <unknown> if source in stack entry does not define a url', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/partials/include.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
          url: 'https://git.example.org/repo-c.git',
        },
      }
      const stack = [
        {
          file: {
            path: 'modules/ROOT/pages/index.adoc',
            origin: {
              type: 'git',
              refname: 'main',
              startPath: '',
            },
          },
          line: 20,
        },
      ]
      const lines = captureStderrSync(() => logger.warn({ file, line: 9, stack }, 'something is out of place'))
      expect(lines).to.have.lengthOf(6)
      expect(lines[1]).to.equal('    file: modules/ROOT/partials/include.adoc:9')
      expect(lines[2]).to.equal('    source: https://git.example.org/repo-c.git (refname: main)')
      expect(lines[4]).to.equal('        file: modules/ROOT/pages/index.adoc:20')
      expect(lines[5]).to.equal('        source: <unknown> (refname: main)')
    })
  })

  describe('failure level', () => {
    it('should set failure level value on root logger for specified failure level', () => {
      const logger = configure({ failureLevel: 'warn' }).get(null)
      expect(logger.failureLevel).to.equal('warn')
      expect(logger.failureLevelVal).to.equal(40)
    })

    it('should set the failure level on root logger to silent if specified failure level is unknown', () => {
      const logger = configure({ failureLevel: 'none' }).get(null)
      expect(logger.failureLevel).to.equal('silent')
      expect(logger.failureLevelVal).to.equal(Infinity)
    })

    it('should not mark root logger to fail on exit if failure level is not met', () => {
      const logger = configure({ failureLevel: 'warn' }).get(null)
      expect(logger.failOnExit).to.be.undefined()
      captureStdoutLogSync(() => logger.info('love is the message'))
      expect(logger.failOnExit).to.be.undefined()
    })

    it('should mark root logger to fail on exit if failure level is met', () => {
      const logger = configure({ failureLevel: 'warn' }).get(null)
      expect(logger.failOnExit).to.be.undefined()
      captureStdoutLogSync(() => {
        logger.info('love is the message')
        logger.warn('something is out of place')
      })
      expect(logger.failOnExit).to.be.true()
    })

    it('should mark root logger to fail on exit if failure level is exceeded', () => {
      const logger = configure({ failureLevel: 'warn' }).get(null)
      expect(logger.failOnExit).to.be.undefined()
      captureStdoutLogSync(() => {
        logger.info('love is the message')
        logger.error('something went terribly wrong')
      })
      expect(logger.failOnExit).to.be.true()
    })

    it('should mark root logger to fail on exit if failure level is exceeded by named logger', () => {
      const rootLogger = configure({ failureLevel: 'warn' }).get(null)
      const namedLogger = get('foobar')
      expect(rootLogger.failOnExit).to.be.undefined()
      captureStdoutLogSync(() => {
        rootLogger.info('love is the message')
        namedLogger.error('something went terribly wrong')
      })
      expect(rootLogger.failOnExit).to.be.true()
    })

    it('should mark root logger to fail on exit even when root logger is silent', () => {
      const logger = configure({ level: 'silent', failureLevel: 'warn' }).get(null)
      expect(logger.failOnExit).to.be.undefined()
      logger.info('love is the message')
      logger.error('something went terribly wrong')
      expect(logger.failOnExit).to.be.true()
    })

    it('should mark root logger to fail on exit when setFailOnExit() is invoked on root logger', () => {
      const rootLogger = configure().get(null)
      expect(rootLogger.failOnExit).to.be.undefined()
      rootLogger.setFailOnExit()
      expect(rootLogger.failOnExit).to.be.true()
    })

    it('should mark root logger to fail on exit when setFailOnExit() is invoked on named logger', () => {
      const rootLogger = configure().get(null)
      expect(rootLogger.failOnExit).to.be.undefined()
      get('foobar').setFailOnExit()
      expect(rootLogger.failOnExit).to.be.true()
    })
  })

  describe('destination', () => {
    it('should allow custom destination with write method to be specified', () => {
      const destination = new (class {
        constructor () {
          this.messages = []
        }

        write (message) {
          this.messages.push(message)
          return message.length
        }
      })()
      const logger = configure({ destination }).get(null)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.be.empty()
      const messages = destination.messages
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.include('{"')
      const { time, ...message } = JSON.parse(messages[0])
      expect(typeof time).to.equal('number')
      expect(message).to.eql({ name: 'antora', level: 'info', msg: 'love is the message' })
    })

    it('should ignore custom destination if empty', () => {
      const logger = configure({ destination: {} }).get(null)
      expect(getStream(logger).write).to.be.instanceOf(Function)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
    })
  })

  describe('finalize()', () => {
    it('should close logger and return Promise to resolves to failOnExit value', async () => {
      ;[Logger.finalize, finalizeLogger].forEach(async (fn) => {
        const logger = configure({ failureLevel: 'warn' }).get()
        captureStdoutSync(() => logger.fatal('a tree falling in the forest'))
        const failOnExit = await fn()
        expect(getLogger(null).closed).to.be.true()
        expect(failOnExit).to.be.true()
      })
    })
  })

  describe('unwrap()', () => {
    beforeEach(configure)

    it('should intercept call to unwrap return logger without proxy', () => {
      const logger = get('foobar')
      expect(types.isProxy(logger)).to.be.true()
      const rawLogger = logger.unwrap()
      expect(rawLogger).to.not.equal(logger)
      expect(types.isProxy(rawLogger)).to.be.false()
      configure({ level: 'debug' })
      expect(logger.level).to.equal('debug')
      expect(rawLogger.level).to.equal('info')
    })
  })
})

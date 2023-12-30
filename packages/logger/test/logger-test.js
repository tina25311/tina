/* eslint-env mocha */
'use strict'

const {
  captureStderrSync,
  captureStdout,
  captureStdoutLog,
  captureStdoutLogSync,
  captureStdoutSync,
  emptyDirSync,
  expect,
  trapAsyncError,
  wipeSync,
} = require('@antora/test-harness')

const Logger = require('@antora/logger')
const { configure, configureLogger, finalizeLogger, get, getLogger } = Logger
const ospath = require('path')
const { types } = require('util')
const pino = require('pino')
const { prettyFactory: pinoPrettyFactory } = require('pino-pretty')
const SonicBoom = require('sonic-boom')

const WORK_DIR = ospath.join(__dirname, 'work')

describe('logger', () => {
  const getStream = (logger) => logger[pino.symbols.streamSym]

  const supportsColor = pinoPrettyFactory()({ msg: 'colorize' }).includes('\u001b[')

  const NO_COLOR = process.env.NO_COLOR
  const FORCE_COLOR = process.env.FORCE_COLOR

  beforeEach(() => {
    process.env.NO_COLOR = '1'
    delete process.env.FORCE_COLOR
  })

  afterEach(() => {
    if ((process.env.NO_COLOR = NO_COLOR) == null) delete process.env.NO_COLOR
    if ((process.env.FORCE_COLOR = FORCE_COLOR) == null) delete process.env.FORCE_COLOR
  })

  describe('configure()', () => {
    const getHooks = (logger) => logger[pino.symbols.hooksSym]

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
        expect(logger.bindings()).to.eql({})
        expect(getStream(logger)).to.be.instanceOf(SonicBoom)
        expect(getHooks(logger).logMethod).to.be.instanceOf(Function)
      })
    })

    it('should set name on root logger if passed to configure', () => {
      const logger = configure({ name: 'antora' }).get(null)
      expect(logger.bindings()).to.eql({ name: 'antora' })
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
      expect(getStream(logger)).to.be.instanceOf(SonicBoom)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.eql({ level: 'info', msg: 'love is the message' })
    })

    it('should include hint key if specified in merging object', () => {
      const logger = configure().get(null)
      const lines = captureStdoutSync(() => logger.info({ hint: 'let the music play' }, 'love is the message'))
      expect(lines).to.have.lengthOf(1)
      expect(JSON.parse(lines[0])).to.include({ hint: 'let the music play', msg: 'love is the message' })
    })

    it('should allow fatal message to be logged', () => {
      const logger = configure().get(null)
      expect(getStream(logger).flushSync).to.be.undefined() // pino's fatal handler will invoke flushSync if present
      const lines = captureStdoutSync(() => logger.fatal("You've sunk my battleship!"))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.eql({ level: 'fatal', msg: "You've sunk my battleship!" })
    })

    it('should allow error to be logged at fatal level', () => {
      const err = new TypeError('uh oh!')
      const logger = configure().get(null)
      const lines = captureStdoutSync(() => logger.fatal(err))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.have.property('level', 'fatal')
      expect(message).to.have.property('msg', 'uh oh!')
      expect(message).to.not.have.property('type')
      expect(message).to.not.have.property('message')
      expect(message).to.have.property('err')
      expect(message).to.have.nested.property('err.type', 'TypeError')
      expect(message).to.have.nested.property('err.stack')
      expect(message).to.not.have.nested.property('err.message')
      expect(message.err.stack).to.startWith('TypeError\n    at ')
    })

    it('should preserve error message if different from log message', () => {
      const err = new TypeError('bad code')
      const logger = configure().get(null)
      const lines = captureStdoutSync(() => logger.fatal(err, 'uh oh!'))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.have.property('level', 'fatal')
      expect(message).to.have.property('msg', 'uh oh!')
      expect(message).to.not.have.property('type')
      expect(message).to.not.have.property('message')
      expect(message).to.have.property('err')
      expect(message).to.have.nested.property('err.type', 'TypeError')
      expect(message).to.have.nested.property('err.stack')
      expect(message).to.have.nested.property('err.message', 'bad code')
      expect(message.err.stack).to.startWith('TypeError\n    at ')
    })

    it('should format log level as number of levelFormat is number', () => {
      const logger = configure({ levelFormat: 'number' }).get(null)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.eql({ level: 30, msg: 'love is the message' })
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
      expect(stream).to.not.be.instanceOf(SonicBoom)
      expect(stream.stream).to.be.instanceOf(SonicBoom)
      const lines = captureStderrSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      expect(lines[0]).to.not.include('{')
      expect(lines[0]).to.include('INFO: love is the message')
    })

    it('should configure root logger using structured (JSON) format if format is unrecognized', () => {
      const logger = configure({ format: 'structured' }).get(null)
      expect(getStream(logger)).to.be.instanceOf(SonicBoom)
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
      // a) use these assertions if the default format is json
      //const messages = captureStdoutLogSync(() => get().info('too soon!'))
      //expect(messages).to.have.lengthOf(2)
      //expect(messages[0]).to.include({
      //  level: 'warn',
      //  msg: 'logger not configured; creating logger with default settings',
      //})
      //expect(messages[1]).to.include({ level: 'info', msg: 'too soon!' })
      // b) use these assertions if the default format is pretty
      const lines = captureStderrSync(() => get().info('too soon!'))
      expect(lines).to.have.lengthOf(2)
      const expectedLine1 = /^\[.+\] WARN: logger not configured; creating logger with default settings$/
      const expectedLine2 = /^\[.+\] INFO: too soon!/
      expect(lines[0]).to.match(expectedLine1)
      expect(lines[1]).to.match(expectedLine2)
    })

    it('should return proxy of the root logger if no name is specified', () => {
      configure({ name: 'antora' })
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
    beforeEach(() => configure({ name: 'antora' }))

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

    it('should not reshape object if file property is not an object', () => {
      const logObject = { file: 'config.yml' }
      const name = 'foobar'
      const logger = get(name)
      const messages = captureStdoutLogSync(() => logger.warn(logObject, 'duplicate entry'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = { level: 'warn', name, file: 'config.yml', msg: 'duplicate entry' }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should reshape the file object when origin is not set', () => {
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        file: { path: 'modules/ROOT/pages/index.adoc' },
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
          gitdir: '/path/to/repo/.git',
          worktree: '/path/to/worktree',
        },
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        file: { path: '/path/to/worktree/modules/ROOT/pages/index.adoc' },
        source: {
          url: 'https://git.example.org/repo.git',
          local: '/path/to/repo/.git',
          refname: 'main',
          reftype: 'branch',
          worktree: '/path/to/worktree',
        },
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should reshape the file object from ref of remote repo', () => {
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
        source: { url: 'https://git.example.org/repo.git', refname: 'main', reftype: 'branch' },
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should reshape the file object from local ref of local repo', () => {
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
          url: 'https://git.example.org/repo.git',
          gitdir: '/path/to/repo/.git',
          worktree: false,
        },
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        file: { path: 'modules/ROOT/pages/index.adoc' },
        source: {
          url: 'https://git.example.org/repo.git',
          local: '/path/to/repo/.git',
          refname: 'main',
          reftype: 'branch',
          worktree: false,
        },
        msg: 'something is out of place',
      }
      expect(messages[0]).to.eql(expectedData)
    })

    it('should reshape the file object from remote ref of local repo', () => {
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'main',
          startPath: '',
          url: 'https://git.example.org/repo.git',
          gitdir: '/path/to/repo/.git',
          worktree: false,
          remote: 'origin',
        },
      }
      const messages = captureStdoutLogSync(() => logger.warn({ file }, 'something is out of place'))
      expect(messages).to.have.lengthOf(1)
      const expectedData = {
        level: 'warn',
        name,
        file: { path: 'modules/ROOT/pages/index.adoc' },
        source: {
          url: 'https://git.example.org/repo.git',
          local: '/path/to/repo/.git',
          refname: 'main',
          reftype: 'branch',
          remote: 'origin',
          worktree: false,
        },
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
          gitdir: '/path/to/repo/.git',
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
          local: '/path/to/repo/.git',
          worktree: '/path/to/worktree',
          refname: 'main',
          reftype: 'branch',
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
          reftype: 'branch',
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
          reftype: 'branch',
          startPath: 'docs',
        },
        stack: [
          {
            file: { path: 'docs/modules/ROOT/partials/include.adoc', line: 5 },
            source: {
              url: 'https://git.example.org/repo.git',
              refname: 'main',
              reftype: 'branch',
              startPath: 'docs',
            },
          },
          {
            file: { path: 'docs/modules/ROOT/pages/index.adoc', line: 20 },
            source: {
              url: 'https://git.example.org/repo.git',
              refname: 'main',
              reftype: 'branch',
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
    it('should write pretty log message to stderr by default when format is pretty', () => {
      const logger = configure({ name: 'antora', format: 'pretty' }).get()
      const lines = captureStderrSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const expectedLine = /^\[.+\] INFO \(antora\): love is the message$/
      expect(lines[0]).to.match(expectedLine)
    })

    if (supportsColor) {
      it('should not colorize pretty log message if NO_COLOR environment variable is set', () => {
        process.env.NO_COLOR = '1'
        const logger = configure({ name: 'antora', format: 'pretty' }).get()
        const lines = captureStderrSync(() => logger.info('love is the message'))
        expect(lines).to.have.lengthOf(1)
        const expectedLine = 'INFO (antora): love is the message'
        expect(lines[0]).to.include(expectedLine)
      })

      it('should colorize pretty log message if supported by environment', () => {
        delete process.env.NO_COLOR
        const logger = configure({ name: 'antora', format: 'pretty' }).get()
        const lines = captureStderrSync(() => logger.info('love is the message'))
        expect(lines).to.have.lengthOf(1)
        const expectedLine = '\u001b[32mINFO\u001b[39m (antora): \u001b[36mlove is the message\u001b[39m'
        expect(lines[0]).to.include(expectedLine)
      })

      // NOTE since colorette caches the state, this test only tests the code path, not the full integration
      it('should colorize pretty log message if FORCE_COLOR environment variable is set', () => {
        delete process.env.NO_COLOR
        process.env.FORCE_COLOR = '1'
        const logger = configure({ name: 'antora', format: 'pretty' }).get()
        const lines = captureStderrSync(() => logger.info('love is the message'))
        expect(lines).to.have.lengthOf(1)
        const expectedLine = '\u001b[32mINFO\u001b[39m (antora): \u001b[36mlove is the message\u001b[39m'
        expect(lines[0]).to.include(expectedLine)
      })

      it('should colorize only first line of pretty log message if supported by environment', () => {
        delete process.env.NO_COLOR
        const logger = configure({ name: 'antora', format: 'pretty' }).get()
        const lines = captureStderrSync(() => logger.info('love is the message\nmusic is the answer'))
        expect(lines).to.have.lengthOf(2)
        const expectedLine1 = '\u001b[32mINFO\u001b[39m (antora): \u001b[36mlove is the message'
        const expectedLine2 = '\u001b[0mmusic is the answer\u001b[39m'
        expect(lines[0]).to.include(expectedLine1)
        expect(lines[1]).to.include(expectedLine2)
      })

      it('should colorize hint of pretty log message if supported by environment', () => {
        delete process.env.NO_COLOR
        const logger = configure({ name: 'antora', format: 'pretty' }).get()
        const lines = captureStderrSync(() => logger.info({ hint: 'let the music play' }, 'love is the message'))
        expect(lines).to.have.lengthOf(2)
        const expectedLine1 = '\u001b[32mINFO\u001b[39m (antora): \u001b[36mlove is the message'
        const expectedLine2 = '\u001b[0m\u001b[2mlet the music play\u001b[22m'
        expect(lines[0]).to.include(expectedLine1)
        expect(lines[1]).to.include(expectedLine2)
      })
    }

    it('should append hint in merging object below message', () => {
      const logger = configure({ name: 'antora', format: 'pretty' }).get()
      const lines = captureStderrSync(() => logger.info({ hint: 'let the music play' }, 'love is the message'))
      expect(lines).to.have.lengthOf(2)
      const expectedLine1 = 'INFO (antora): love is the message'
      const expectedLine2 = 'let the music play'
      expect(lines[0]).to.include(expectedLine1)
      expect(lines[1]).to.include(expectedLine2)
    })

    // NOTE there's no longer a workaround for this since we don't use pino to create the pretty destination
    it('should not log warning that flushSync is not supported when fatal message is logged', () => {
      const logger = configure({ format: 'pretty' }).get()
      const stream = getStream(logger)
      expect(stream.flushSync).to.be.undefined() // pino's fatal handler will invoke flushSync if present
      expect(stream.stream.flushSync).to.be.undefined()
      const lines = captureStderrSync(() => logger.fatal("You've sunk my battleship!"))
      expect(lines).to.have.lengthOf(1)
      const expectedLine = /^\[.+\] FATAL: You've sunk my battleship!$/
      expect(lines[0]).to.match(expectedLine)
    })

    it('should print error with stack logged at fatal level', () => {
      const err = new TypeError('uh oh!')
      const logger = configure({ format: 'pretty' }).get()
      const lines = captureStderrSync(() => logger.fatal(err))
      expect(lines.length).to.be.greaterThan(2)
      expect(lines[0]).to.match(/^\[.+\] FATAL: uh oh!$/)
      expect(lines[1]).to.match(/^ {4}Cause: TypeError$/)
      expect(lines[2]).to.match(/^ {8}at /)
    })

    it('should preserve error message if different from log message', () => {
      const err = new TypeError('bad code')
      const logger = configure({ format: 'pretty' }).get()
      const lines = captureStderrSync(() => logger.fatal(err, 'uh oh!'))
      expect(lines.length).to.be.greaterThan(2)
      expect(lines[0]).to.match(/^\[.+\] FATAL: uh oh!$/)
      expect(lines[1]).to.match(/^ {4}Cause: TypeError: bad code$/)
      expect(lines[2]).to.match(/^ {8}at /)
    })

    it('should report cause as no stacktrace if stack property is not set on error object', () => {
      const err = new Error('vague error')
      delete err.stack
      const logger = configure({ format: 'pretty' }).get()
      const lines = captureStderrSync(() => logger.fatal(err, 'uh oh!'))
      expect(lines).to.have.lengthOf(2)
      expect(lines[0]).to.match(/^\[.+\] FATAL: uh oh!$/)
      expect(lines[1]).to.equal('    Cause: Error (no stacktrace)')
    })

    it('should not modify log name if error contains hostname property', () => {
      const err = Object.assign(new Error('bad connection'), { hostname: 'example.org' })
      const logger = configure({ format: 'pretty' }).get('antora')
      const lines = captureStderrSync(() => logger.fatal(err, 'disruption!'))
      expect(lines.length).to.be.greaterThan(2)
      expect(lines[0]).to.endWith(' FATAL (antora): disruption!')
    })

    it('should ignore levelFormat setting when format is pretty', () => {
      const logger = configure({ name: 'antora', format: 'pretty', levelFormat: 'number' }).get()
      const lines = captureStderrSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const expectedLine = /^\[.+\] INFO \(antora\): love is the message$/
      expect(lines[0]).to.match(expectedLine)
    })

    // NOTE this test verifies the proxy still intercepts property assignments after logger is reconfigured
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
      expect(lines[2]).to.equal('    source: https://git.example.org/repo.git (branch: main)')
    })

    it('should print source object from remote branch on a single line', () => {
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
          gitdir: '/path/to/repo/.git',
          remote: 'origin',
          worktree: false,
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[2]).to.equal('    source: /path/to/repo/.git (branch: main <remotes/origin>)')
    })

    it('should print source object from remote tag on a single line', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'v1.0.0',
          tag: 'v1.0.0',
          startPath: '',
          url: 'https://git.example.org/repo.git',
          gitdir: '/path/to/repo/.git',
          remote: 'origin',
          worktree: false,
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[2]).to.equal('    source: /path/to/repo/.git (tag: v1.0.0 <remotes/origin>)')
    })

    it('should print source object with start path from ref on a single line', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/pages/index.adoc',
        origin: {
          type: 'git',
          refname: 'v2.0.0',
          tag: 'v2.0.0',
          startPath: 'docs',
          url: 'https://git.example.org/repo.git',
        },
      }
      const lines = captureStderrSync(() => logger.warn({ file }, 'something is out of place'))
      expect(lines).to.have.lengthOf(3)
      expect(lines[2]).to.equal('    source: https://git.example.org/repo.git (tag: v2.0.0 | start path: docs)')
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
      expect(lines[2]).to.equal('    source: /path/to/worktree (branch: main <worktree>)')
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
      expect(lines[2]).to.equal('    source: /path/to/worktree (branch: main <worktree> | start path: docs)')
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
      expect(lines[2]).to.equal('    source: <unknown> (branch: main)')
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
      expect(lines[5]).to.equal('        source: https://git.example.org/repo-b.git (branch: main | start path: docs)')
      expect(lines[6]).to.equal('        file: docs/modules/ROOT/pages/index.adoc:20')
      expect(lines[7]).to.equal('        source: /path/to/repo-a (branch: main <worktree> | start path: docs)')
    })

    it('should not show line after path if line is missing for top-level object or entry in stack', () => {
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
            path: 'modules/ROOT/pages/index.adoc',
            origin: {
              type: 'git',
              refname: 'main',
              startPath: 'docs',
              url: 'https://git.example.org/repo-a.git',
              worktree: '/path/to/repo-a',
            },
          },
        },
      ]
      const lines = captureStderrSync(() => logger.warn({ file, stack }, 'something is out of place'))
      expect(lines).to.have.lengthOf(6)
      expect(lines[1]).to.equal('    file: docs/modules/ROOT/partials/nested-include.adoc')
      expect(lines[4]).to.equal('        file: docs/modules/ROOT/pages/index.adoc')
      expect(lines[5]).to.equal('        source: /path/to/repo-a (branch: main <worktree> | start path: docs)')
    })

    it('should consider source with same refname and different worktree as unique', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = {
        path: 'modules/ROOT/partials/include.adoc',
        origin: {
          type: 'git',
          refname: 'v3.0.x',
          startPath: 'docs',
          url: 'https://git.example.org/repo-b.git',
        },
      }
      const stack = [
        {
          file: {
            path: 'modules/ROOT/pages/index.adoc',
            origin: {
              type: 'git',
              refname: 'v3.0.x',
              startPath: 'docs',
              url: 'https://git.example.org/repo-b.git',
              worktree: '/path/to/repo-a',
            },
          },
          line: 10,
        },
      ]
      const lines = captureStderrSync(() => logger.warn({ file, line: 2, stack }, 'something is out of place'))
      expect(lines).to.have.lengthOf(6)
      expect(lines[4]).to.equal('        file: docs/modules/ROOT/pages/index.adoc:10')
      expect(lines[5]).to.equal('        source: /path/to/repo-a (branch: v3.0.x <worktree> | start path: docs)')
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
      expect(lines[5]).to.equal('        source: https://git.example.org/repo-b.git (branch: main)')
      expect(lines[6]).to.equal('        file: modules/ROOT/pages/index.adoc:20')
      expect(lines[7]).to.equal('        source: /path/to/repo-a (branch: main <worktree>)')
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
      expect(lines[6]).to.equal('        source: https://git.example.org/repo-2.git (branch: main | start path: docs)')
    })

    it('should not show source if origin is not available', () => {
      configure({ format: 'pretty' })
      const name = 'foobar'
      const logger = get(name)
      const file = { path: 'modules/ROOT/partials/include.adoc' }
      const stack = [
        {
          file: { path: 'modules/ROOT/pages/index.adoc' },
          line: 20,
        },
      ]
      const lines = captureStderrSync(() => logger.warn({ file, line: 9, stack }, 'something is out of place'))
      expect(lines).to.have.lengthOf(4)
      expect(lines[1]).to.equal('    file: modules/ROOT/partials/include.adoc:9')
      expect(lines[3]).to.equal('        file: modules/ROOT/pages/index.adoc:20')
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
      expect(lines[2]).to.equal('    source: https://git.example.org/repo-c.git (branch: main)')
      expect(lines[4]).to.equal('        file: modules/ROOT/pages/index.adoc:20')
      expect(lines[5]).to.equal('        source: <unknown> (branch: main)')
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
    beforeEach(() => wipeSync(WORK_DIR))

    afterEach(finalizeLogger)

    after(() => wipeSync(WORK_DIR))

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
      expect(message).to.eql({ level: 'info', msg: 'love is the message' })
    })

    // NOTE pino.destination may use a different version of sonic-boom
    it('should support custom sync destination created by pino.destination', () => {
      const destination = pino.destination({ dest: 1, sync: true })
      const logger = configure({ destination }).get(null)
      const stream = getStream(logger)
      expect(stream).to.equal(destination)
      expect(stream.listeners('error')).to.have.lengthOf(1) // asserts the built-in safe SonicBoom
      const messages = captureStdoutLogSync(() => logger.info('love is the message'))
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.include({ level: 'info', msg: 'love is the message' })
    })

    // NOTE pino.destination may use a different version of sonic-boom
    it('should support custom async destination created by pino.destination', async () => {
      const destination = pino.destination({ dest: 1, sync: false, minLength: 4096 })
      const logger = configure({ destination }).get(null)
      const stream = getStream(logger)
      expect(stream).to.equal(destination)
      expect(stream.listeners('error')).to.have.lengthOf(1) // asserts the built-in safe SonicBoom
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.be.empty()
      const messages = await captureStdoutLog(finalizeLogger)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.include({ level: 'info', msg: 'love is the message' })
    })

    it('should ignore custom destination if empty', () => {
      const logger = configure({ destination: {} }).get(null)
      expect(getStream(logger).write).to.be.instanceOf(Function)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
    })

    it('should write structured (JSON) log message to stderr if value of destination.file is stderr', () => {
      const logger = configure({ destination: { file: 'stderr' } }).get(null)
      const lines = captureStderrSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.eql({ level: 'info', msg: 'love is the message' })
    })

    it('should write structured (JSON) log message to stderr if value of destination.file is 2', () => {
      const logger = configure({ destination: { file: '2' } }).get(null)
      expect(ospath.join(process.cwd(), '2')).to.not.be.a.path()
      expect(ospath.join(process.cwd(), 'stderr')).to.not.be.a.path()
      const lines = captureStderrSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const { time, ...message } = JSON.parse(lines[0])
      expect(typeof time).to.equal('number')
      expect(message).to.eql({ level: 'info', msg: 'love is the message' })
    })

    it('should write pretty log message to stdout if value of destination.file is stdout', () => {
      const logger = configure({ name: 'antora', format: 'pretty', destination: { file: 'stdout' } }).get(null)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const expectedLine = /^\[.+\] INFO \(antora\): love is the message$/
      expect(lines[0]).to.match(expectedLine)
    })

    it('should write pretty log message to stdout if value of destination.file is 1', () => {
      const logger = configure({ name: 'antora', format: 'pretty', destination: { file: '1' } }).get(null)
      expect(ospath.join(process.cwd(), '1')).to.not.be.a.path()
      expect(ospath.join(process.cwd(), 'stdout')).to.not.be.a.path()
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.have.lengthOf(1)
      const expectedLine = /^\[.+\] INFO \(antora\): love is the message$/
      expect(lines[0]).to.match(expectedLine)
    })

    it('should write to file specified by destination.file, creating directory if needed', () => {
      expect(WORK_DIR).to.not.be.a.path()
      const logger = configure({ destination: { file: './antora.log' } }, WORK_DIR).get(null)
      expect(WORK_DIR).to.be.a.directory()
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      const stream = getStream(logger)
      expect(stream).to.have.property('sync', true)
      expect(stream).to.have.property('minLength', 0)
      expect(stream).to.have.property('file', logFile)
      logger.info('love is the message')
      // NOTE in this case, there's no need to wait for call to finalize
      expect(logFile)
        .to.be.a.file()
        .with.json()
        .and.have.contents.that.match(/"msg":"love is the message"/)
    })

    it('should resolve destination file relative to current directory if baseDir is not specified', async () => {
      const cwd = process.cwd()
      try {
        emptyDirSync(WORK_DIR)
        process.chdir(WORK_DIR)
        const logger = configure({ destination: { file: './antora.log' } }).get(null)
        const logFile = ospath.join(WORK_DIR, 'antora.log')
        const stream = getStream(logger)
        expect(stream).to.have.property('file', logFile)
        logger.info('love is the message')
        expect(logFile)
          .to.be.a.file()
          .with.json()
          .and.have.contents.that.match(/"msg":"love is the message"/)
      } finally {
        process.chdir(cwd)
      }
    })

    it('should write to file specified by destination.file when logger is finalized if bufferSize is non-zero', async () => {
      const bufferSize = 4096
      const logger = configure({ destination: { file: './antora.log', bufferSize } }, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      const stream = getStream(logger)
      expect(stream).to.have.property('sync', true)
      expect(stream).to.have.property('minLength', bufferSize)
      expect(stream).to.have.property('file', logFile)
      logger.info('love is the message')
      expect(logFile).to.be.a.file().and.be.empty()
      await finalizeLogger()
      expect(logFile)
        .to.be.a.file()
        .with.json()
        .and.have.contents.that.match(/"msg":"love is the message"/)
    })

    it('should write to file specified by destination.file when logger is finalized if sync is false', async () => {
      const logger = configure({ destination: { file: './antora.log', sync: false } }, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      const stream = getStream(logger)
      expect(stream).to.have.property('sync', false)
      expect(stream).to.have.property('minLength', 0)
      expect(stream).to.have.property('file', null)
      logger.info('love is the message')
      // NOTE sonic-boom will create the file on demand
      expect(logFile).to.not.be.a.path()
      await finalizeLogger()
      expect(logFile)
        .to.be.a.file()
        .with.json()
        .and.have.contents.that.match(/"msg":"love is the message"/)
    })

    it('should create empty file at destination.file when logger is finalized if sync is false and no messages are logged', async () => {
      const logger = configure({ destination: { file: './antora.log', sync: false } }, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      const stream = getStream(logger)
      expect(stream).to.have.property('sync', false)
      // NOTE sonic-boom will create the file on demand
      expect(logFile).to.not.be.a.path()
      await finalizeLogger()
      expect(logFile).to.be.a.file().and.be.empty()
    })

    it('should write to file specified by destination.file when logger is finalized if sync is false and bufferSize is non-zero', async () => {
      const bufferSize = 4096
      const logger = configure({ destination: { file: './antora.log', sync: false, bufferSize } }, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      const stream = getStream(logger)
      expect(stream).to.have.property('sync', false)
      expect(stream).to.have.property('minLength', bufferSize)
      expect(stream).to.have.property('file', null)
      logger.info('love is the message')
      await finalizeLogger()
      expect(logFile)
        .to.be.a.file()
        .with.json()
        .and.have.contents.that.match(/"msg":"love is the message"/)
    })

    it('should write to standard stream specified by destination.file when logger is finalized if bufferSize is non-zero', async () => {
      const bufferSize = 4096
      const logger = configure({ destination: { file: 'stdout', bufferSize } }, WORK_DIR).get(null)
      const stream = getStream(logger)
      expect(stream).to.have.property('sync', true)
      expect(stream).to.have.property('minLength', bufferSize)
      expect(stream).to.have.property('fd', 1)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.be.empty()
      const messages = await captureStdoutLog(finalizeLogger)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].msg).to.equal('love is the message')
    })

    it('should write to standard stream specified by destination.file when logger is finalized if sync is false and bufferSize is non-zero', async () => {
      const bufferSize = 4096
      const logger = configure({ destination: { file: 'stdout', sync: false, bufferSize } }, WORK_DIR).get(null)
      const stream = getStream(logger)
      expect(stream).to.have.property('sync', false)
      expect(stream).to.have.property('minLength', bufferSize)
      expect(stream).to.have.property('fd', 1)
      const lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.be.empty()
      const messages = await captureStdoutLog(finalizeLogger)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].msg).to.equal('love is the message')
    })

    it('should honor bufferSize option when format is pretty', async () => {
      const opts = { format: 'pretty', destination: { file: 'stdout', bufferSize: 4096 } }
      const logger = configure(opts, WORK_DIR).get(null)
      const stream = getStream(logger)
      expect(stream).to.not.have.property('fd')
      expect(stream).to.not.have.property('minLength')
      expect(stream).to.not.have.property('sync')
      const realStream = stream.stream
      expect(realStream).to.have.property('fd', 1)
      expect(realStream).to.have.property('sync', true)
      expect(realStream).to.have.property('minLength', 4096)
      let lines = captureStdoutSync(() => logger.info('love is the message'))
      expect(lines).to.be.empty()
      const fs = require('fs')
      const originalWrite = fs.write
      lines = await captureStdout(finalizeLogger)
      expect(fs.write).to.equal(originalWrite) // verify that captureStdout releases fs.write
      expect(lines).to.have.lengthOf(1)
      const expectedLine = /^\[.+\] INFO: love is the message$/
      expect(lines[0]).to.match(expectedLine)
    })

    it('should honor sync option when format is pretty', async () => {
      const opts = { format: 'pretty', destination: { file: './antora.log', sync: false } }
      const logger = configure(opts, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      const stream = getStream(logger)
      expect(stream).to.not.have.property('fd')
      expect(stream).to.not.have.property('minLength')
      expect(stream).to.not.have.property('sync')
      const realStream = stream.stream
      expect(realStream).to.have.property('fd')
      expect(realStream).to.have.property('sync', false)
      expect(realStream).to.have.property('minLength', 0)
      logger.info('love is the message')
      // NOTE sonic-boom will create the file on demand
      expect(logFile).to.not.be.a.path()
      await finalizeLogger()
      const expectedLine = /^\[.+\] INFO: love is the message\n/
      expect(logFile).to.be.a.file().and.have.contents.that.match(expectedLine)
    })

    it('should create empty file at destination.file if sync is false, format is pretty, and no messages are logged', async () => {
      const opts = { format: 'pretty', destination: { file: './antora.log', sync: false } }
      const logger = configure(opts, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      expect(getStream(logger).stream).to.have.property('sync', false)
      // NOTE sonic-boom will create the file on demand
      expect(logFile).to.not.be.a.path()
      await finalizeLogger()
      expect(logFile).to.be.a.file().and.be.empty()
    })

    it('should append to file specified by destination.file by default', async () => {
      const opts = { destination: { file: './antora.log' } }
      let logger = configure(opts, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      logger.info('love is the message')
      await finalizeLogger()
      logger = configure(opts, WORK_DIR).get(null)
      logger.info('music all life long')
      expect(logFile)
        .to.be.a.file()
        .and.have.contents.that.match(/"msg":"music all life long"/)
        .and.have.contents.that.match(/"msg":"love is the message"/)
    })

    it('should not append to file specified by destination.file if append is false', async () => {
      const opts = { destination: { file: './antora.log', append: false } }
      let logger = configure(opts, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      logger.info('love is the message')
      await finalizeLogger()
      logger = configure(opts, WORK_DIR).get(null)
      logger.info('music all life long')
      expect(logFile)
        .to.be.a.file()
        .and.have.contents.that.match(/"msg":"music all life long"/)
        .and.not.have.contents.that.match(/"msg":"love is the message"/)
    })

    it('should append to file specified by destination.file by default when format is pretty', async () => {
      const opts = { format: 'pretty', destination: { file: './antora.log' } }
      let logger = configure(opts, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      logger.info('love is the message')
      await finalizeLogger()
      logger = configure(opts, WORK_DIR).get(null)
      logger.info('music all life long')
      expect(logFile)
        .to.be.a.file()
        .and.have.contents.that.match(/love is the message/)
        .and.have.contents.that.match(/music all life long/)
    })

    it('should not append to file specified by destination.file if append is false and format is pretty', async () => {
      const opts = { format: 'pretty', destination: { file: './antora.log', append: false } }
      let logger = configure(opts, WORK_DIR).get(null)
      const logFile = ospath.join(WORK_DIR, 'antora.log')
      logger.info('love is the message')
      await finalizeLogger()
      logger = configure(opts, WORK_DIR).get(null)
      logger.info('music all life long')
      expect(logFile)
        .to.be.a.file()
        .and.have.contents.that.match(/music all life long/)
        .and.not.have.contents.that.match(/love is the message/)
    })

    it('should not colorize pretty log message when writing to a file', () => {
      const nodeEnv = process.env.NODE_ENV
      try {
        delete process.env.NODE_ENV
        const destination = { file: './antora.log' }
        const logger = configure({ name: 'antora', format: 'pretty', destination }, WORK_DIR).get(null)
        const logFile = ospath.join(WORK_DIR, 'antora.log')
        logger.info('love is the message')
        expect(logFile)
          .to.be.a.file()
          .and.have.contents.that.match(/ INFO \(antora\): love is the message/)
      } finally {
        process.env.NODE_ENV = nodeEnv
      }
    })
  })

  describe('finalize()', () => {
    it('should close logger and return Promise to resolves to failOnExit value', async () => {
      await Promise.all(
        [Logger.finalize, finalizeLogger].map(async (fn) => {
          const logger = configure({ failureLevel: 'warn' }).get()
          captureStdoutSync(() => logger.fatal('a tree falling in the forest'))
          const failOnExit = await fn()
          expect(getLogger(null).closed).to.be.true()
          expect(failOnExit).to.be.true()
        })
      )
    })

    // NOTE the following tests emulate a broken pipe

    it('should not attempt to close destination if destination is sync and has already been destroyed', async () => {
      const logger = configure({ destination: { file: 'stdout' } }).get(null)
      const stream = getStream(logger)
      const lines = captureStdoutSync(() => logger.info('say it plain'))
      expect(lines).to.have.lengthOf(1)
      stream.end()
      let p
      expect((p = finalizeLogger)).to.not.throw()
      await p
    })

    it('should not attempt to close destination if destination is async and has already been destroyed', async () => {
      const bufferSize = 4096
      const logger = configure({ destination: { file: 'stdout', bufferSize, sync: false } }).get(null)
      const stream = getStream(logger)
      const lines = captureStdoutSync(() => logger.info('say it plain'))
      expect(lines).to.be.empty()
      stream.fd = 100000 // emulate not being able to write to file descriptor
      expect(await trapAsyncError(finalizeLogger)).to.not.throw()
    })

    it('should ignore failure and prevent further writes if destination throws EPIPE error', async () => {
      const logger = configure().get(null)
      const stream = getStream(logger)
      expect(stream.listeners('error')).to.have.lengthOf(1) // asserts our custom safe SonicBoom
      const writes = []
      const write_ = stream.write
      stream.write = function (message) {
        writes.push(message)
        if (~message.indexOf('play')) {
          const err = Object.assign(new Error('broken pipe, write'), { code: 'EPIPE', errno: -32, syscall: 'write' })
          this.emit('error', err)
          return
        }
        return write_.call(this, message)
      }
      const lines = captureStdoutSync(() => {
        logger.info('love is the message')
        logger.info('let the music play')
        logger.info('let the music play')
        logger.info('let the music play')
      })
      expect(stream.destroyed).to.be.true()
      expect(lines).to.have.lengthOf(1)
      expect(writes).to.have.lengthOf(2)
      expect(lines[0]).to.equal(writes[0].trim())
      expect(writes[0]).to.include('love is the message')
      expect(writes[1]).to.include('let the music play')
      expect(await finalizeLogger).to.not.throw()
      expect(writes).to.have.lengthOf(2)
    })

    it('should not attempt to close pretty destination if destination is sync and has already been destroyed', async () => {
      const logger = configure({ format: 'pretty', destination: { file: 'stdout' } }).get(null)
      const stream = getStream(logger)
      expect(stream.listeners('error')).to.have.lengthOf(1) // asserts our custom safe SonicBoom
      const lines = captureStdoutSync(() => logger.info('say it plain'))
      expect(lines).to.have.lengthOf(1)
      const realStream = stream.stream
      realStream.end()
      let p
      expect((p = finalizeLogger)).to.not.throw()
      await p
    })

    it('should not attempt to close pretty destination if destination is async and has already been destroyed', async () => {
      const bufferSize = 4096
      const logger = configure({ format: 'pretty', destination: { file: 'stdout', bufferSize, sync: false } }).get(null)
      const stream = getStream(logger)
      const lines = captureStdoutSync(() => logger.info('say it plain'))
      expect(lines).to.be.empty()
      const realStream = stream.stream
      realStream.fd = 100000 // emulate not being able to write to file descriptor
      expect(await trapAsyncError(finalizeLogger)).to.not.throw()
    })

    it('should ignore failure and prevent further writes if destination throws EPIPE error', async () => {
      const logger = configure({ format: 'json', destination: { file: 'stdout' } }).get(null)
      const stream = getStream(logger)
      expect(stream.flushSync).to.be.undefined()
      const writes = []
      const write_ = stream.write
      stream.write = function (message) {
        writes.push(message)
        if (~message.indexOf('play')) {
          const err = Object.assign(new Error('broken pipe, write'), { code: 'EPIPE', errno: -32, syscall: 'write' })
          this.emit('error', err)
          return
        }
        return write_.call(this, message)
      }
      const lines = captureStdoutSync(() => {
        logger.info('love is the message')
        logger.info('let the music play')
        logger.info('let the music play')
        logger.info('let the music play')
      })
      expect(stream.destroyed).to.be.true()
      expect(lines).to.have.lengthOf(1)
      expect(writes).to.have.lengthOf(2)
      expect(lines[0]).to.equal(writes[0].trim())
      expect(writes[0]).to.include('love is the message')
      expect(writes[1]).to.include('let the music play')
      expect(await finalizeLogger).to.not.throw()
      expect(writes).to.have.lengthOf(2)
    })

    it('should ignore failure and prevent further writes if pino.destination throws EPIPE error', async () => {
      const destination = pino.destination({ dest: 1, sync: true })
      const logger = configure({ format: 'json', destination }).get(null)
      const stream = getStream(logger)
      expect(stream.flushSync).to.be.undefined()
      const writes = []
      const write_ = stream.write
      stream.write = function (message) {
        writes.push(message)
        if (~message.indexOf('play')) {
          const err = Object.assign(new Error('broken pipe, write'), { code: 'EPIPE', errno: -32, syscall: 'write' })
          this.emit('error', err)
          return
        }
        return write_.call(this, message)
      }
      const lines = captureStdoutSync(() => {
        logger.info('love is the message')
        logger.info('let the music play')
        logger.info('let the music play')
        logger.info('let the music play')
      })
      expect(stream.destroyed).to.not.be.true() // optimization not applied for pino.destination
      expect(lines).to.have.lengthOf(1)
      expect(writes).to.have.lengthOf(2)
      expect(lines[0]).to.equal(writes[0].trim())
      expect(writes[0]).to.include('love is the message')
      expect(writes[1]).to.include('let the music play')
      expect(await finalizeLogger).to.not.throw()
      expect(writes).to.have.lengthOf(2)
    })

    it('should ignore failure and prevent further writes if pretty destination throws EPIPE error', async () => {
      const logger = configure({ format: 'pretty', destination: { file: 'stderr' } }).get(null)
      const stream = getStream(logger).stream
      expect(stream.flushSync).to.be.undefined()
      const writes = []
      const write_ = stream.write
      stream.write = function (message) {
        writes.push(message)
        if (~message.indexOf('play')) {
          const err = Object.assign(new Error('broken pipe, write'), { code: 'EPIPE', errno: -32, syscall: 'write' })
          this.emit('error', err)
          return
        }
        return write_.call(this, message)
      }
      const lines = captureStderrSync(() => {
        logger.info('love is the message')
        logger.info('let the music play')
        logger.info('let the music play')
        logger.info('let the music play')
      })
      expect(stream.destroyed).to.be.true()
      expect(lines).to.have.lengthOf(1)
      expect(writes).to.have.lengthOf(2)
      expect(lines[0]).to.equal(writes[0].trim())
      expect(writes[0]).to.include('love is the message')
      expect(writes[1]).to.include('let the music play')
      expect(await finalizeLogger).to.not.throw()
      expect(writes).to.have.lengthOf(2)
    })

    it('should not moderate destination that is a function', async () => {
      const destination = new (class extends require('events') {
        constructor () {
          super()
          this.messages = []
        }

        write (message) {
          this.messages.push(message)
          if (~message.indexOf('play')) {
            const err = Object.assign(new Error('broken pipe, write'), { code: 'EPIPE', errno: -32, syscall: 'write' })
            this.emit('error', err)
            return
          }
          return message.length
        }
      })()
      const logger = configure({ destination }).get(null)
      const stream = getStream(logger)
      expect(stream).to.not.have.property('flushSync')
      logger.info('love is the message')
      expect(() => logger.info('let the music play')).to.throw('broken pipe, write')
      expect(stream.destroyed).to.not.be.true()
      const messages = stream.messages
      expect(messages).to.have.lengthOf(2)
      expect(messages[0]).to.include('love is the message')
      expect(messages[1]).to.include('let the music play')
      expect(await finalizeLogger).to.not.throw()
    })
  })

  describe('unwrap()', () => {
    it('should intercept call to unwrap return logger without proxy', () => {
      const logger = configure().get('foobar')
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

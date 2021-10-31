'use strict'

const { EventEmitter, once } = require('events')
const expandPath = require('@antora/expand-path-helper')
const ospath = require('path')
const { posix: path } = ospath
const {
  levels: { labels: levelLabels, values: levelValues },
  symbols: { streamSym },
  pino,
} = require('pino')
const SonicBoom = require('sonic-boom')

const closedLogger = { closed: true }
const finalizers = []
const INF = Infinity
const minLevel = levelLabels[Math.min.apply(null, Object.keys(levelLabels))]
const noopLogger = pino({ base: null, enabled: false, timestamp: false }, {})
const rootLoggerHolder = new Map()
const standardStreams = { 1: 'stdout', 2: 'stderr', stderr: 2, stdout: 1 }

function close () {
  const rootLogger = rootLoggerHolder.get() || closedLogger
  if (rootLogger.closed) return
  const dest = Object.assign(rootLogger, closedLogger)[streamSym].stream || rootLogger[streamSym]
  if (dest instanceof EventEmitter && typeof dest.end === 'function') {
    if (!(dest.fd in standardStreams)) {
      finalizers.push(once(dest, 'close').catch(() => undefined)) && dest.end()
    } else if ((dest._bufs || dest._buf).length) {
      finalizers.push(once(dest, 'drain')) && dest.flush()
    }
  }
}

function configure ({ name, level = 'info', levelFormat, failureLevel = 'silent', format, destination } = {}, baseDir) {
  let logger
  if ((levelValues[level] || (level === 'all' ? (level = minLevel) : INF)) === INF) {
    if ((levelValues[failureLevel] || INF) === INF && (rootLoggerHolder.get() || {}).noop) return module.exports
    close()
    logger = Object.assign(Object.create(Object.getPrototypeOf(noopLogger)), noopLogger)
  } else {
    const prettyPrint = format === 'pretty'
    let colorize, dest
    if (typeof (destination || (destination = {})).write !== 'function') {
      const { file, bufferSize, ...destOpts } = destination
      if (bufferSize != null) destOpts.minLength = bufferSize
      if (file && !(dest = standardStreams[file])) {
        dest = expandPath(file, { dot: baseDir })
      } else if (prettyPrint) {
        dest = dest || 2
        if (process.env.NODE_ENV !== 'test') colorize = true
      }
      destOpts.dest = dest || 1
      destination = new SonicBoom(Object.assign({ mkdir: true, sync: true }, destOpts))
    }
    close()
    logger = pino(
      {
        name,
        base: {},
        level,
        formatters: { level: levelFormat === 'number' ? (_, level) => ({ level }) : (level) => ({ level }) },
        hooks: {
          // NOTE logMethod only called if log level is enabled
          logMethod (args, method) {
            const arg0 = args[0]
            if (arg0.constructor === Object) {
              const { file, line, stack, ...obj } = arg0
              // NOTE we assume file key is a file.src object
              args[0] = file ? Object.assign(obj, reshapeFileForLog(arg0)) : obj
            }
            method.apply(this, args)
          },
        },
        prettyPrint: prettyPrint && {
          customPrettifiers: {
            file: ({ path: path_, line }) => (line == null ? path_ : `${path_}:${line}`),
            stack: (stack, _, log) => {
              let prevSource = log.source
              return stack
                .map(({ file: { path: path_, line }, source }) => {
                  const file = `${path_}:${line}`
                  const repeatSource =
                    prevSource &&
                    source.url === prevSource.url &&
                    source.refname === prevSource.refname &&
                    source.startPath === prevSource.startPath
                  prevSource = source
                  if (repeatSource) return `\n    file: ${file}`
                  const { url, worktree, refname, startPath } = source
                  source = worktree
                    ? `${worktree} (refname: ${refname} <worktree>${startPath ? ', start path: ' + startPath : ''})`
                    : `${url || '<unknown>'} (refname: ${refname}${startPath ? ', start path: ' + startPath : ''})`
                  return `\n    file: ${file}\n    source: ${source}`
                })
                .join('')
            },
            source: ({ url, worktree, refname, startPath }) =>
              worktree
                ? `${worktree} (refname: ${refname} <worktree>${startPath ? ', start path: ' + startPath : ''})`
                : `${url || '<unknown>'} (refname: ${refname}${startPath ? ', start path: ' + startPath : ''})`,
          },
          translateTime: 'SYS:HH:MM:ss.l', // Q: do we really need ms? should we honor DATE_FORMAT env var?
          ...(colorize ? undefined : { colorize: false }),
        },
      },
      destination
    )
    logger[streamSym].flushSync = logger.silent // better alternative to suppressFlushSyncWarning option
    if (prettyPrint) logger[streamSym].stream = destination
  }
  rootLoggerHolder.set(undefined, addFailOnExitHooks(logger, failureLevel))
  return module.exports
}

function get (name) {
  if (name === null) return rootLoggerHolder.get()
  return new Proxy(noopLogger, {
    resolveTarget () {
      if ((this.ownRootLogger || closedLogger).closed) {
        if ((this.ownRootLogger = rootLoggerHolder.get() || closedLogger).closed) {
          ;(this.ownRootLogger = configure().get(null)).warn(
            'logger not configured; creating logger with default settings'
          )
        }
        this.target = undefined
      }
      return this.target || (this.target = name ? this.ownRootLogger.child({ name }) : this.ownRootLogger)
    },
    get (_, property) {
      return property === 'unwrap' ? () => this.resolveTarget() : this.resolveTarget()[property]
    },
    set (_, property, value) {
      this.resolveTarget()[property] = value
      return true
    },
  })
}

function finalize () {
  close()
  return Promise.all(finalizers.splice(0, finalizers.length)).then(() => (rootLoggerHolder.get() || {}).failOnExit)
}

function reshapeFileForLog ({ file: { abspath, origin, path: vpath }, line, stack }) {
  if (origin) {
    const { url, refname, startPath, worktree } = origin
    const logObject = {
      file: { path: abspath || path.join(startPath, vpath), line },
      source: worktree
        ? { url, worktree, refname, startPath: startPath || undefined }
        : { url, refname, startPath: startPath || undefined },
    }
    if (stack) logObject.stack = stack.map(reshapeFileForLog)
    return logObject
  }
  return stack ? { file: { path: vpath, line }, stack: stack.map(reshapeFileForLog) } : { file: { path: vpath, line } }
}

function addFailOnExitHooks (logger, failureLevel = undefined) {
  let failureLevelVal
  if (failureLevel === undefined) {
    failureLevelVal = logger.failureLevelVal
  } else {
    logger.failureLevelVal = failureLevelVal = levelValues[failureLevel] || INF
    Object.defineProperty(logger, 'failureLevel', {
      enumerable: true,
      get () {
        return levelLabels[this.failureLevelVal]
      },
    })
    logger.setFailOnExit = setFailOnExit.bind(logger) // direct call to base logger
    logger.child = ((method) =>
      function (bindings) {
        return addFailOnExitHooks(method.call(this, bindings))
      })(logger.child)
  }
  Object.defineProperty(logger, 'noop', {
    enumerable: true,
    get () {
      return this.levelVal === INF && this.failureLevelVal === INF
    },
  })
  if (failureLevelVal !== INF) {
    for (const [levelName, levelVal] of Object.entries(levelValues)) {
      if (levelVal >= failureLevelVal) logger[levelName] = decorateWithSetFailOnExit(logger[levelName])
    }
  }
  return logger
}

function decorateWithSetFailOnExit (method) {
  return method.name === 'noop'
    ? callSetFailOnExit
    : function (...args) {
      this.setFailOnExit()
      method.apply(this, args)
    }
}

function callSetFailOnExit () {
  this.setFailOnExit()
}

function setFailOnExit () {
  this.failOnExit = true
}

module.exports = Object.assign(get, {
  close,
  closeLogger: close,
  configure,
  configureLogger: configure,
  finalize,
  finalizeLogger: finalize,
  get,
  getLogger: get,
})

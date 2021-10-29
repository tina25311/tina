'use strict'

const EventEmitter = require('events')
const getLogger = require('@antora/logger')
const userRequire = require('@antora/user-require-helper')

const FUNCTION_PROVIDERS = {
  aggregateContent: 'content-aggregator',
  buildNavigation: 'navigation-builder',
  classifyContent: 'content-classifier',
  convertDocument: 'document-converter',
  convertDocuments: 'document-converter',
  createPageComposer: 'page-composer',
  extractAsciiDocMetadata: 'asciidoc-loader',
  loadAsciiDoc: 'asciidoc-loader',
  loadUi: 'ui-loader',
  mapSite: 'site-mapper',
  produceRedirects: 'redirect-producer',
  publishSite: 'site-publisher',
  resolveAsciiDocConfig: 'asciidoc-loader',
}

class HaltSignal extends Error {}

class GeneratorContext extends EventEmitter {
  constructor (playbook, module_) {
    super()
    if (!('path' in (this.module = module_))) module_.path = require('path').dirname(module_.filename)
    _registerFunctions.call(this, playbook, module_)
    _registerExtensions.call(this, playbook, module_, _initVariables.call(this, playbook))
  }

  getFunctions (fxns) {
    return arguments[0] === false ? fxns : Object.assign({}, fxns)
  }

  getLogger (name = 'antora') {
    return getLogger(name)
  }

  getVariables (vars) {
    return Object.assign({}, vars)
  }

  halt () {
    throw new HaltSignal()
  }

  async notify (eventName) {
    if (!this.listenerCount(eventName)) return
    for (const listener of this.rawListeners(eventName)) {
      const outcome = listener.length === 1 ? listener.call(this, this.getVariables()) : listener.call(this)
      if (outcome instanceof Promise) await outcome
    }
  }

  replaceFunctions (fxns, updates) {
    Object.entries(updates).map(([name, fxn]) => {
      if (name in fxns) fxns[name] = fxn.bind(this)
    })
  }

  require (request) {
    return this.module.require(request)
  }

  updateVariables (vars, updates) {
    try {
      Object.assign(vars, updates)
    } catch (err) {
      if (err instanceof TypeError) {
        err.message = err.message.replace(/ assign to read.only property '(.+)' .*/, " update read-only var '$1'")
      }
      throw err
    }
  }

  static isHaltSignal (err) {
    return err instanceof HaltSignal
  }
}

function _initVariables (playbook) {
  const vars = { playbook }
  Object.defineProperty(this, 'vars', {
    configurable: true,
    get: () => {
      delete this.vars
      return Object.setPrototypeOf(vars, {
        lock (name) {
          return Object.defineProperty(this, name, { configurable: false, writable: false })[name]
        },
        remove (name) {
          const currentValue = this[name]
          delete this[name]
          return currentValue
        },
      })
    },
  })
  this.getVariables = this.getVariables.bind(null, vars)
  // TODO remove updateVars before Antora 3.0.0
  this.updateVars = this.updateVariables = this.updateVariables.bind(null, vars)
  return vars
}

function _registerExtensions (playbook, module_, vars) {
  const extensions = (playbook.antora || {}).extensions || []
  if (extensions.length) {
    const requireContext = { dot: playbook.dir, paths: [playbook.dir || '', module_.path] }
    extensions.forEach((ext) => {
      const { enabled = true, id, require: request, ...config } = ext.constructor === String ? { require: ext } : ext
      if (!enabled) return
      const { register } = userRequire(request, requireContext)
      if (typeof register !== 'function') return
      if (register.length) {
        if (/^(?:function *)?(?:\w+ *)?\( *\w|^\w+(?: *, *\w+)* *=>/.test(register.toString().replace(/\r?\n/g, ' '))) {
          register.length === 1 ? register(this) : register(this, Object.assign({ config }, vars))
        } else {
          register.call(this, Object.assign({ config }, vars))
        }
      } else {
        register.call(this)
      }
    })
  }
  this.notify = this.eventNames().length ? this.notify.bind(this) : async () => undefined
}

function _registerFunctions (playbook) {
  const fxns = Object.entries(
    Object.entries(FUNCTION_PROVIDERS).reduce((accum, [fxnName, moduleKey]) => {
      accum[moduleKey] = (accum[moduleKey] || []).concat(fxnName)
      return accum
    }, {})
  ).reduce((accum, [moduleKey, fxnNames]) => {
    const defaultExport = this.require('@antora/' + moduleKey)
    const defaultExportName = defaultExport.name
    fxnNames.forEach((fxnName) => {
      const fxn = fxnName === defaultExportName ? defaultExport : defaultExport[fxnName]
      accum[fxnName] = fxn.bind(this)
    })
    return accum
  }, {})
  Object.defineProperty(this, 'fxns', {
    configurable: true,
    get: () => {
      delete this.fxns
      return fxns
    },
  })
  this.getFunctions = this.getFunctions.bind(null, fxns)
  this.replaceFunctions = this.replaceFunctions.bind(this, fxns)
}

module.exports = GeneratorContext

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
  #fxns
  #vars

  constructor (playbook, module_) {
    super()
    if (!('path' in (this.module = module_))) module_.path = require('path').dirname(module_.filename)
    this._registerFunctions(module_)
    this._registerExtensions(playbook, this._initVariables(playbook), module_)
    Object.defineProperties(this, { _initVariables: {}, _registerExtensions: {}, _registerFunctions: {} })
  }

  getFunctions () {
    return arguments.length ? this.#fxns : Object.assign({}, this.#fxns)
  }

  getLogger (name = 'antora') {
    return getLogger(name)
  }

  getVariables () {
    return Object.assign({}, this.#vars)
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

  replaceFunctions (updates) {
    const fxns = this.#fxns
    Object.entries(updates).map(([name, fxn]) => {
      if (name in fxns) fxns[name] = fxn.bind(this)
    })
  }

  require (request) {
    return this.module.require(request)
  }

  updateVariables (updates) {
    try {
      Object.assign(this.#vars, updates)
    } catch (err) {
      if (err instanceof TypeError) {
        err.message = err.message.replace(/ assign to read.only property '(.+)' .*/, " update read-only var '$1'")
      }
      throw err
    }
  }

  // TODO remove updateVars before Antora 3.0.0
  updateVars (updates) {
    return this.updateVariables(updates)
  }

  static isHaltSignal (err) {
    return err instanceof HaltSignal
  }

  _initVariables (playbook) {
    Object.defineProperty(this, 'vars', {
      configurable: true,
      get: () => {
        delete this.vars
        return Object.setPrototypeOf(this.#vars, {
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
    return (this.#vars = { playbook })
  }

  _registerExtensions (playbook, vars, module_) {
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

  _registerFunctions (module_) {
    this.#fxns = Object.entries(
      Object.entries(FUNCTION_PROVIDERS).reduce((accum, [fxnName, moduleKey]) => {
        accum[moduleKey] = (accum[moduleKey] || []).concat(fxnName)
        return accum
      }, {})
    ).reduce((accum, [moduleKey, fxnNames]) => {
      const defaultExport = module_.require('@antora/' + moduleKey)
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
        return this.#fxns
      },
    })
  }
}

module.exports = GeneratorContext

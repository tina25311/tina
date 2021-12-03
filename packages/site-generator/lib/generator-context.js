'use strict'

const EventEmitter = require('events')
const getLogger = require('@antora/logger')
const noopNotify = async function notify () {}
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
  publishFiles: 'file-publisher',
  resolveAsciiDocConfig: 'asciidoc-loader',
}

const FUNCTION_WITH_POSITIONAL_PARAMETER_RX = /^(?:function *)?(?:\w+ *)?\( *\w|^\w+(?: *, *\w+)* *=>/
const NEWLINES_RX = /\r?\n/g

class StopSignal extends Error {}

class GeneratorContext extends EventEmitter {
  #fxns
  #vars

  constructor (module_) {
    super()
    // deprecated method aliases - remove for Antora 3.0.0
    Object.defineProperties(this, { halt: { value: this.stop }, updateVars: { value: this.updateVariables } })
    if (!('path' in (this.module = module_))) module_.path = require('path').dirname(module_.filename)
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

  lockVariable (name) {
    return Object.defineProperty(this.#vars, name, { configurable: false, writable: false })[name]
  }

  async notify (eventName) {
    if (!this.listenerCount(eventName)) return
    for (const listener of this.rawListeners(eventName)) {
      const outcome = listener.length === 1 ? listener.call(this, this.getVariables()) : listener.call(this)
      if (outcome instanceof Promise) await outcome
    }
    if (!this._eventsCount) Object.defineProperty(this, 'notify', { value: noopNotify })
  }

  removeVariable (name) {
    try {
      const value = this.#vars[name]
      delete this.#vars[name]
      return value
    } catch (err) {
      if (err instanceof TypeError) {
        err.message = err.message.replace(/ delete property '(.+?)' .*/, " remove locked variable '$1'")
      }
      throw err
    }
  }

  replaceFunctions (updates) {
    const fxns = this.#fxns
    Object.entries(updates).forEach(([name, fxn]) => {
      if (name in fxns) fxns[name] = fxn.bind(this)
    })
  }

  require (request) {
    return this.module.require(request)
  }

  stop (code) {
    if (code != null) process.exitCode = code
    throw Object.assign(new StopSignal(), { notify: this.notify.bind(this, 'contextStopped') })
  }

  updateVariables (updates) {
    try {
      Object.assign(this.#vars, updates)
    } catch (err) {
      if (err instanceof TypeError) {
        err.message = err.message.replace(/ assign to read.only property '(.+?)' .*/, " update locked variable '$1'")
      }
      throw err
    }
  }

  static async close (instance) {
    await instance.notify('contextClosed').catch(() => undefined)
  }

  static isStopSignal (err) {
    return err instanceof StopSignal
  }

  static async start (instance, playbook) {
    const returnValue = instance._init(playbook)
    await instance.notify('contextStarted')
    return returnValue
  }

  _init (playbook) {
    this._registerFunctions()
    this._registerExtensions(playbook, this._initVariables(playbook))
    Object.defineProperties(this, { _init: {}, _initVariables: {}, _registerExtensions: {}, _registerFunctions: {} })
    return { fxns: this.#fxns, vars: this.#vars }
  }

  _initVariables (playbook) {
    return (this.#vars = { playbook })
  }

  _registerExtensions (playbook, vars) {
    const extensions = (playbook.antora || {}).extensions || []
    if (extensions.length) {
      const requireContext = { dot: playbook.dir, paths: [playbook.dir || '', this.module.path] }
      extensions.forEach((ext) => {
        const { enabled = true, id, require: request, ...config } = ext.constructor === String ? { require: ext } : ext
        if (!enabled) return
        const { register } = userRequire(request, requireContext)
        if (typeof register !== 'function') return
        if (register.length) {
          if (FUNCTION_WITH_POSITIONAL_PARAMETER_RX.test(register.toString().replace(NEWLINES_RX, ' '))) {
            register.length === 1 ? register(this) : register(this, Object.assign({ config }, vars))
          } else {
            register.call(this, Object.assign({ config }, vars))
          }
        } else {
          register.call(this)
        }
      })
    }
    if (!this._eventsCount) Object.defineProperty(this, 'notify', { value: noopNotify })
  }

  _registerFunctions () {
    this.#fxns = Object.entries(
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
    Object.defineProperty(this.#fxns, 'publishSite', {
      enumerable: true,
      get () {
        return this.publishFiles
      },
      set (value) {
        this.publishFiles = value
      },
    })
  }
}

module.exports = GeneratorContext

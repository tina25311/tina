'use strict'

const EventEmitter = require('events')
const getLogger = require('@antora/logger')
const userRequire = require('@antora/user-require-helper')

class HaltSignal extends Error {}

class GeneratorContext extends EventEmitter {
  constructor (playbook, module_) {
    super()
    if (!('path' in (this.module = module_))) module_.path = require('path').dirname(module_.filename)
    _registerExtensions.call(this, playbook, module_, _initVars.call(this, playbook))
  }

  getLogger (name = 'antora') {
    return getLogger(name)
  }

  getVars (vars) {
    return Object.assign({}, vars)
  }

  halt () {
    throw new HaltSignal()
  }

  async notify (eventName) {
    if (this.listenerCount(eventName)) {
      for (const listener of this.rawListeners(eventName)) {
        const outcome = listener.length === 1 ? listener.call(this, this.getVars()) : listener.call(this)
        if (outcome instanceof Promise) await outcome
      }
    }
  }

  require (request) {
    return this.module.require(request)
  }

  updateVars (vars, updates) {
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

function _initVars (playbook) {
  const vars = Object.setPrototypeOf(
    { playbook },
    {
      lock (name) {
        return Object.defineProperty(this, name, { configurable: false, writable: false })[name]
      },
      remove (name) {
        const currentValue = this[name]
        delete this[name]
        return currentValue
      },
    }
  )
  Object.defineProperty(this, 'vars', {
    configurable: true,
    get: () => {
      delete this.vars
      return vars
    },
  })
  this.getVars = this.getVars.bind(null, vars)
  this.updateVars = this.updateVars.bind(null, vars)
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

module.exports = GeneratorContext

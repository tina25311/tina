'use strict'

const name = 'test-attribute'
const value = 'test-attribute-value'

module.exports.isEnabled = function (config) {
  return config.stage === 'page-header'
}

module.exports.register = function (registry, config = {}) {

  function attributesIncludeProcessor () {
    const self = this
    self.handles(function (target) {
      return target.startsWith('attributes$')
    })
    self.process(function (doc, reader, target, attributes) {
      const headerAttributes = doc.header_attributes
      const docAttributes = doc.attributes
      headerAttributes !== Opal.nil && headerAttributes['$[]='](name, value)
      docAttributes['$[]='](name, value)
      // reader.pushInclude(`:${name}: ${value}\n`, '', '', 1, attributes)
    })
  }

  function doRegister (registry) {
    if (typeof registry.includeProcessor === 'function') {
      registry.prefer('include_processor', attributesIncludeProcessor)
    } else {
      console.warn('no \'includeProcessor\' method on alleged registry')
    }
  }

  if (typeof registry.register === 'function') {
    registry.register(function () {
      //Capture the global registry so processors can register more extensions.
      registry = this
      doRegister(registry)
    })
  } else {
    doRegister(registry)
  }
  return registry
}

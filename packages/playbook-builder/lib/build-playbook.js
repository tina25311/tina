'use strict'

const camelCaseKeys = require('camelcase-keys')
const convict = require('./solitary-convict')
const defaultSchema = require('./config/schema')
const fs = require('fs')
const ospath = require('path')

/**
 * Builds a playbook object according to the provided schema from the specified
 * arguments and environment variables.
 *
 * Accepts an array of command line arguments (in the form of option flags and
 * switches) and a map of environment variables and translates this data into a
 * playbook object according the the specified schema. If no schema is
 * specified, the default schema provided by this package is used.
 *
 * @memberof playbook-builder
 *
 * @param {Array} [args=[]] - An array of arguments in the form of command line
 *   option flags and switches. Should begin with the first flag or switch.
 * @param {Object} [env={}] - A map of environment variables.
 * @param {Object} [schema=undefined] - A convict configuration schema.
 * @param {Function} [beforeValidate=undefined] - A function to invoke on the
 *   config before validating it.
 *
 * @returns {Object} A playbook object containing a hierarchical structure that
 *   mirrors the configuration schema. With the exception of the top-level asciidoc
 *   key and its descendants, all keys in the playbook are camelCased.
 */
function buildPlaybook (args = [], env = {}, schema = undefined, beforeValidate = undefined) {
  const config = loadConvictConfig(args, env, schema)
  const relSpecFilePath = config.get('playbook')
  if (relSpecFilePath) {
    let absSpecFilePath = ospath.resolve(relSpecFilePath)
    if (ospath.extname(absSpecFilePath)) {
      if (!fs.existsSync(absSpecFilePath)) {
        let details = ''
        if (relSpecFilePath !== absSpecFilePath) {
          details = ` (path: ${relSpecFilePath}${ospath.isAbsolute(relSpecFilePath) ? '' : ', cwd: ' + process.cwd()})`
        }
        throw new Error(`playbook file not found at ${absSpecFilePath}${details}`)
      }
    } else if (fs.existsSync(absSpecFilePath + '.yml')) {
      absSpecFilePath += '.yml'
    } else if (fs.existsSync(absSpecFilePath + '.json')) {
      absSpecFilePath += '.json'
    } else if (fs.existsSync(absSpecFilePath + '.toml')) {
      absSpecFilePath += '.toml'
    } else {
      const details = `(path: ${relSpecFilePath}${ospath.isAbsolute(relSpecFilePath) ? '' : ', cwd: ' + process.cwd()})`
      throw new Error(
        `playbook file not found at ${absSpecFilePath}.yml, ${absSpecFilePath}.json, or ${absSpecFilePath}.toml ` +
          details
      )
    }
    config.loadFile(absSpecFilePath)
    if (relSpecFilePath !== absSpecFilePath) config.set('playbook', absSpecFilePath)
  }
  const beforeValidateFromSchema = config._def[Symbol.for('convict.beforeValidate')]
  if (beforeValidateFromSchema) beforeValidateFromSchema(config)
  if (beforeValidate) beforeValidate(config)
  return config.getModel()
}

function loadConvictConfig (args, env, customSchema) {
  return Object.assign(convict(customSchema || defaultSchema, { args, env }), { getModel })
}

function getModel (name = '') {
  let config = this
  const data = config.get(name)
  let schema = config._schema
  if (name) {
    schema = name.split('.').reduce((accum, key) => accum._cvtProperties[key], schema)
    config = Object.assign(convict(name.split('.').reduce((def, key) => def[key], config._def)), { _instance: data })
  }
  config.validate({ allowed: 'strict' })
  const model = camelCaseKeys(data, { deep: true, stopPaths: getStopPaths(schema._cvtProperties) })
  if (!name) {
    Object.defineProperty(model, 'env', { value: config.getEnv() })
    model.dir = model.playbook ? ospath.dirname((model.file = model.playbook)) : process.cwd()
    delete model.playbook
  }
  return deepFreeze(model)
}

function getStopPaths (schemaProperties, schemaPath = [], stopPaths = []) {
  for (const [key, { preserve, _cvtProperties }] of Object.entries(schemaProperties)) {
    if (preserve) {
      Array.isArray(preserve)
        ? preserve.forEach((it) => stopPaths.push(schemaPath.concat(key, it).join('.')))
        : stopPaths.push(schemaPath.concat(key).join('.'))
    } else if (_cvtProperties) {
      stopPaths.push(...getStopPaths(_cvtProperties, schemaPath.concat(key)))
    }
  }
  return stopPaths
}

function deepFreeze (o) {
  for (const v of Object.values(o)) Object.isFrozen(v) || deepFreeze(v)
  return Object.freeze(o)
}

module.exports = Object.assign(buildPlaybook, { defaultSchema })

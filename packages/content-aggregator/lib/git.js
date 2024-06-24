'use strict'

const zlib = require('node:zlib')
const { promisify } = require('node:util')

module.exports = ((pakoModuleId) => {
  const git = require('isomorphic-git')
  require(pakoModuleId).inflate = promisify(zlib.inflate)
  return git
})('pako')

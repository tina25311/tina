'use strict'

module.exports = require('node:path').sep === '\\' ? (p) => p.replace(/\\/g, '/') : undefined

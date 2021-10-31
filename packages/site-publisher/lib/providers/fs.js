'use strict'

const expandPath = require('@antora/expand-path-helper')
const { promises: fsp } = require('fs')
const ospath = require('path')
const posixify = ospath.sep === '\\' ? (p) => p.replace(/\\/g, '/') : undefined
const publishStream = require('./common/publish-stream')
const { dest: vfsDest } = require('vinyl-fs')

const { DEFAULT_DEST_FS } = require('../constants.js')

function publishToFs (config, files, playbook) {
  const destDir = config.path || DEFAULT_DEST_FS
  const absDestDir = expandPath(destDir, { dot: playbook.dir })
  const report = {
    provider: 'fs',
    path: destDir,
    resolvedPath: absDestDir,
    fileUri: 'file://' + (posixify ? '/' + posixify(absDestDir) : absDestDir),
  }
  return config.clean
    ? fsp['rm' in fsp ? 'rm' : 'rmdir'](absDestDir, { recursive: true, force: true })
      .then(() => publishStream(vfsDest(absDestDir), files))
      .then(() => report)
    : publishStream(vfsDest(absDestDir), files).then(() => report)
}

module.exports = publishToFs

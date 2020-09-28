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
  const absDestDir = expandPath(destDir, '~+', playbook.dir || '.')
  const report = {
    provider: 'fs',
    path: destDir,
    resolvedPath: absDestDir,
    fileUri: 'file://' + (posixify ? '/' + posixify(absDestDir) : absDestDir),
  }
  return config.clean
    ? rmdir(absDestDir)
      .then(() => publishStream(vfsDest(absDestDir), files))
      .then(() => report)
    : publishStream(vfsDest(absDestDir), files).then(() => report)
}

/**
 * Removes the specified directory, including all of its contents.
 * Equivalent to fs.promises.rmdir(dir, { recursive: true }) in Node 12.
 */
function rmdir (dir) {
  return fsp
    .readdir(dir, { withFileTypes: true })
    .then((its) =>
      Promise.all(
        its.map((it) => (it.isDirectory() ? rmdir(ospath.join(dir, it.name)) : fsp.unlink(ospath.join(dir, it.name))))
      )
    )
    .then(() => fsp.rmdir(dir))
    .catch((err) => {
      if (err.code === 'ENOTDIR') return fsp.unlink(dir)
      if (err.code !== 'ENOENT') throw err
    })
}

module.exports = publishToFs

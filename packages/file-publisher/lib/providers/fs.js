'use strict'

const expandPath = require('@antora/expand-path-helper')
const { promises: fsp } = require('fs')
const mkdirp = (path) => fsp.mkdir(path, { recursive: true })
const rmrf = (path) => fsp['rm' in fsp ? 'rm' : 'rmdir'](path, { recursive: true, force: true })
const { pathToFileURL } = require('url')
const publishStream = require('./common/publish-stream')
const { dest: vfsDest } = require('vinyl-fs')

const { DEFAULT_DEST_FS } = require('../constants.js')

function publishToFs (config, files, playbook) {
  const destDir = config.path || DEFAULT_DEST_FS
  const absDestDir = expandPath(destDir, { dot: playbook.dir })
  return (config.clean ? rmrf(absDestDir).then(() => mkdirp(absDestDir)) : mkdirp(absDestDir))
    .then(() => publishStream(vfsDest(absDestDir, { encoding: false }), files))
    .then(() => ({ provider: 'fs', path: destDir, resolvedPath: absDestDir, fileUri: pathToFileURL(absDestDir).href }))
}

module.exports = publishToFs

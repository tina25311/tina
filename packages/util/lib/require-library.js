'use strict'

const ospath = require('path')
const DOT_RELATIVE_RX = new RegExp(`^\\.{1,2}[/${ospath.sep.replace('/', '').replace('\\', '\\\\')}]`)

function requireLibrary (libraryPath, dir, cache) {
  let resolved = (cache || {})[libraryPath]
  if (resolved === undefined) {
    if (libraryPath.charAt() === '.' && DOT_RELATIVE_RX.test(libraryPath)) {
      // NOTE require resolves a dot-relative path relative to current file; resolve relative to playbook dir instead
      resolved = ospath.resolve(dir || '.', libraryPath)
    } else if (ospath.isAbsolute(libraryPath)) {
      resolved = libraryPath
    } else {
      // NOTE appending node_modules prevents require from looking elsewhere before looking in these paths
      const paths = [dir || '.', ospath.dirname(__dirname)].map((root) => ospath.join(root, 'node_modules'))
      resolved = require.resolve(libraryPath, { paths })
    }
    cache && (cache[libraryPath] = resolved)
  }
  return require(resolved)
}

module.exports = requireLibrary

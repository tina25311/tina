'use strict'

const { promises: fsp } = require('fs')

function patchSource (source) {
  if (source.includes('readmeFilename: ')) return source
  return source.replace(/^ *readme: .+$/m, (match) => `${match},\n${match.replace(/readme/g, 'readmeFilename')}`)
}

;(async () => {
  const sourceFile = require.resolve('@evocateur/libnpmpublish/publish.js')
  await fsp.readFile(sourceFile, 'utf8').then((source) => fsp.writeFile(sourceFile, patchSource(source)))
})()

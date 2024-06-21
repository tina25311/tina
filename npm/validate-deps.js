'use strict'

const { promises: fsp } = require('fs')
const { sep: FILE_SEPARATOR } = require('path')
const builtinModules = require('module').builtinModules.filter((it) => it.charAt() !== '_')

;(async () => {
  for await (const { name: packageName } of await fsp.opendir('packages')) {
    if (packageName === 'antora') continue // TODO do something better here
    const packageDir = `packages${FILE_SEPARATOR}${packageName}`
    const pkg = require(`..${FILE_SEPARATOR}${packageDir}${FILE_SEPARATOR}package.json`)
    const prodDeps =
      packageName === 'test-harness'
        ? Object.keys(pkg.devDependencies || {}).concat('@antora/logger', '@antora/content-classifier', 'mocha')
        : Object.keys(pkg.dependencies || {})
    const devDeps = packageName === 'test-harness' ? [] : Object.keys(pkg.devDependencies || {})
    const deps = [...prodDeps, ...devDeps, `@antora/${packageName}`, '@antora/test-harness']
    for (const scope of ['lib', 'test']) {
      const requests = []
      const dirs = [`${packageDir}${FILE_SEPARATOR}${scope}`]
      let i = 0
      while (i < dirs.length) {
        const dir = dirs[i]
        for await (const dirent of await fsp.opendir(dir).catch(() => [])) {
          const name = dirent.name
          if (dirent.isDirectory()) {
            dirs.push(`${dir}${FILE_SEPARATOR}${name}`)
          } else if (name.endsWith('.js')) {
            await fsp.readFile(`${dir}${FILE_SEPARATOR}${name}`, 'utf8').then((contents) => {
              for (const [, request] of new Set(contents.matchAll(/require\('(.+?)'\)/g))) {
                if (request.startsWith('.') || ~builtinModules.indexOf(request)) continue
                const deepIdx = request.indexOf('/', request.startsWith('@') ? request.indexOf('/') + 1 : 0)
                requests.push(~deepIdx ? request.substr(0, deepIdx) : request)
              }
            })
          }
        }
        i++
      }
      const runtimeDeps = scope === 'lib' ? prodDeps : deps
      const uniqueRequests = [...new Set(requests)]
      for (const request of uniqueRequests) {
        if (request.charAt() !== '#' && !~runtimeDeps.indexOf(request)) {
          reportError(`missing ${request} in ${pkg.name} (${scope})`)
        }
      }
      const scopedDeps = scope === 'lib' ? prodDeps : devDeps
      const unused = scopedDeps.reduce((accum, dep) => {
        if (~uniqueRequests.indexOf(dep)) accum.delete(dep)
        return accum
      }, new Set(scopedDeps))
      if (unused.size) {
        for (const dep of unused) reportError(`unused ${dep} in ${pkg.name} (${scope})`)
      }
    }
  }
})()

function reportError (msg) {
  process.exitCode = 1
  console.error(msg)
}

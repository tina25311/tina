'use strict'

const { exec } = require('child_process')
const { promises: fsp } = require('fs')
const ospath = require('path')
const { promisify } = require('util')

const PROJECT_ROOT_DIR = ospath.join(__dirname, '..')
const CHANGELOG_FILE = ospath.join(PROJECT_ROOT_DIR, 'CHANGELOG.adoc')
const DOCS_CONFIG_FILE = ospath.join(PROJECT_ROOT_DIR, 'docs/antora.yml')
const PACKAGE_LOCK_FILE = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
const PACKAGES_DIR = ospath.join(PROJECT_ROOT_DIR, 'packages')
const VERSION = process.env.npm_package_version

function getCurrentDate () {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
}

function updateDocsConfig () {
  const hyphenIdx = VERSION.indexOf('-')
  const base = ~hyphenIdx ? VERSION.substr(0, hyphenIdx) : VERSION
  const [major, minor, patch] = base.split('.')
  const prerelease = ~hyphenIdx ? VERSION.substr(hyphenIdx + 1) : undefined
  return fsp
    .readFile(DOCS_CONFIG_FILE, 'utf8')
    .then((desc) =>
      fsp.writeFile(
        DOCS_CONFIG_FILE,
        desc
          .replace(/^version: \S+$/m, `version: ${q(major + '.' + minor)}`)
          .replace(/^prerelease: \S+$/m, `prerelease: ${prerelease ? q('.' + patch + '-' + prerelease) : 'false'}`),
        'utf8'
      )
    )
    .then(() => promisify(exec)('git add docs/antora.yml', { cwd: PROJECT_ROOT_DIR }))
}

function updateChangelog (releaseDate) {
  const releaseDateString = releaseDate.toISOString().split('T')[0]
  return fsp
    .readFile(CHANGELOG_FILE, 'utf8')
    .then((changelog) =>
      fsp.writeFile(
        CHANGELOG_FILE,
        changelog.replace(/^== (?:(Unreleased)|\d.*)$/m, (currentLine, replace) => {
          const newLine = `== ${VERSION} (${releaseDateString})`
          return replace ? newLine : [newLine, '_No changes since previous release._', currentLine].join('\n\n')
        })
      )
    )
    .then(() => promisify(exec)('git add CHANGELOG.adoc', { cwd: PROJECT_ROOT_DIR }))
}

function updatePackageLock () {
  return fsp.readdir(PACKAGES_DIR, { withFileTypes: true }).then((dirents) => {
    const packageNames = dirents.filter((dirent) => dirent.isDirectory()).map(({ name }) => name)
    const moduleNames = packageNames.map((name) => (name === 'antora' ? name : `@antora/${name}`))
    const packagePaths = packageNames.map((name) => `packages/${name}`)
    const gitAddPaths = ['package-lock.json']
    const writes = []
    const packageLock = require(PACKAGE_LOCK_FILE)
    const { packages } = packageLock
    for (const packagePath of packagePaths) {
      if (!(packagePath in packages)) continue
      const packageJsonPath = ospath.join(packagePath, 'package.json')
      const packageJsonFile = ospath.join(PROJECT_ROOT_DIR, packageJsonPath)
      const packageJson = require(packageJsonFile)
      const packageInfo = packages[packagePath]
      if (packageInfo.version) packageInfo.version = VERSION
      const { dependencies: runtimeDependencies, devDependencies } = packageInfo
      let writePackageJson
      for (const dependencies of [runtimeDependencies, devDependencies]) {
        if (!dependencies) continue
        for (const moduleName of moduleNames) {
          if (moduleName in dependencies) {
            dependencies[moduleName] = VERSION
            packageJson[dependencies === devDependencies ? 'devDependencies' : 'dependencies'][moduleName] = VERSION
            writePackageJson = true
          }
        }
      }
      if (writePackageJson) {
        gitAddPaths.push(packageJsonPath)
        writes.push(fsp.writeFile(packageJsonFile, JSON.stringify(packageJson, undefined, 2) + '\n', 'utf8'))
      }
    }
    writes.push(fsp.writeFile(PACKAGE_LOCK_FILE, JSON.stringify(packageLock, undefined, 2) + '\n', 'utf8'))
    return Promise.all(writes).then(() =>
      promisify(exec)(`git add ${gitAddPaths.join(' ')}`, { cwd: PROJECT_ROOT_DIR })
    )
  })
}

function q (str) {
  return `'${str}'`
}

;(async () => {
  const now = getCurrentDate()
  await updateDocsConfig()
  await updateChangelog(now)
  await updatePackageLock()
})()

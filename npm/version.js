'use strict'

const { promises: fsp } = require('fs')
const https = require('https')
const ospath = require('path')

const NODEJS_RELEASES_URL = 'https://nodejs.org/dist/index.json'
const PROJECT_ROOT_DIR = ospath.join(__dirname, '..')
const CHANGELOG_FILE = ospath.join(PROJECT_ROOT_DIR, 'CHANGELOG.adoc')
const DOCS_CONFIG_FILE = ospath.join(PROJECT_ROOT_DIR, 'docs/antora.yml')
const PACKAGE_LOCK_FILE = ospath.join(PROJECT_ROOT_DIR, 'package-lock.json')
const PACKAGES_DIR = ospath.join(PROJECT_ROOT_DIR, 'packages')
const README_FILE = ospath.join(PROJECT_ROOT_DIR, 'README.adoc')
const VERSION = process.env.npm_package_version

function compareSemVer (a, b) {
  const componentsA = a.split('.')
  const componentsB = b.split('.')
  for (let i = 0; i < 3; i++) {
    const numA = Number(componentsA[i])
    const numB = Number(componentsB[i])
    if (numA > numB) return 1
    if (numB > numA) return -1
  }
  return 0
}

function getCurrentDate () {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
}

function getToolVersions (major) {
  return readFromURL(NODEJS_RELEASES_URL)
    .then(JSON.parse)
    .then((data) => {
      data.forEach((it) => {
        if (it.version.charAt() === 'v') it.version = it.version.substr(1)
      })
      data.sort(({ version: a }, { version: b }) => compareSemVer(b, a))
      const { version, npm } = data.find(major ? ({ version }) => version.startsWith(major + '.') : ({ lts }) => lts)
      return { nodeVersion: version, npmVersion: npm }
    })
}

function readFromURL (url) {
  return new Promise((resolve, reject) => {
    const buffer = []
    https
      .get(url, (response) => {
        response.on('data', (chunk) => buffer.push(chunk.toString()))
        response.on('end', () => resolve(buffer.join('').trimRight()))
      })
      .on('error', reject)
  })
}

function updateDocsDesc (releaseDate) {
  return getToolVersions('16').then(({ nodeVersion, npmVersion }) =>
    Promise.all([
      fsp.readFile(DOCS_CONFIG_FILE, 'utf8').then((contents) => {
        const prerelease = ~VERSION.indexOf('-')
        contents = contents
          .replace(/^(version:) \S+$/m, `$1 ${q(VERSION)}`)
          .replace(/^(prerelease:) \S+$/m, `$1 ${prerelease ? 'true' : 'false'}`)
          .replace(/^( {4}release-version:) \S+$/m, `$1 ${q(VERSION)}`)
          .replace(/^( {4}release-tag:) \S+$/m, `$1 ${prerelease ? 'testing' : 'latest'}`)
          .replace(/^( {4}release-date:) \S+$/m, `$1 ${releaseDate}`)
          .replace(/^( {4}version-node-major:) \S+$/m, `$1 ${q(nodeVersion.split('.')[0])}`)
          .replace(/^( {4}version-node:) \S+$/m, `$1 ${q(nodeVersion)}`)
          .replace(/^( {4}version-npm:) \S+$/m, `$1 ${q(npmVersion)}`)
        return fsp.writeFile(DOCS_CONFIG_FILE, contents, 'utf8')
      }),
      fsp.readFile(README_FILE, 'utf8').then((contents) => {
        contents = contents
          .replace(/^(:version-node-major:) \S+$/m, `$1 ${nodeVersion.split('.')[0]}`)
          .replace(/^(:version-node:) \S+$/m, `$1 ${nodeVersion}`)
        return fsp.writeFile(README_FILE, contents, 'utf8')
      }),
    ])
  )
}

function updateChangelog (releaseDate) {
  return fsp.readFile(CHANGELOG_FILE, 'utf8').then((changelog) =>
    fsp.writeFile(
      CHANGELOG_FILE,
      changelog.replace(/^== (?:(Unreleased)|\d.*)$/m, (currentLine, replace) => {
        const newLine = `== ${VERSION} (${releaseDate})`
        return replace ? newLine : [newLine, '_No changes since previous release._', currentLine].join('\n\n')
      })
    )
  )
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
    return Promise.all(writes)
  })
}

function q (str) {
  return `'${str}'`
}

;(async () => {
  const releaseDate = getCurrentDate().toISOString().split('T')[0]
  await updateDocsDesc(releaseDate)
  await updateChangelog(releaseDate)
  await updatePackageLock()
})()

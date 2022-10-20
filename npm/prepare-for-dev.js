'use strict'

const { promises: fsp } = require('fs')
const ospath = require('path')

const PROJECT_ROOT_DIR = ospath.join(__dirname, '..')
const DOCS_CONFIG_FILE = ospath.join(PROJECT_ROOT_DIR, 'docs/antora.yml')
const VERSION = process.env.npm_package_version

function updateDocsDesc () {
  const hyphenIdx = VERSION.indexOf('-')
  const main = ~hyphenIdx ? VERSION.substr(0, hyphenIdx) : VERSION
  const prerelease = ~hyphenIdx ? VERSION.substr(hyphenIdx + 1) : undefined
  const [major, minor, patch] = main.split('.')
  return fsp.readFile(DOCS_CONFIG_FILE, 'utf8').then((desc) => {
    desc = desc
      .replace(/^version: \S+$/m, `version: ${q(major + '.' + minor)}`)
      .replace(/^prerelease: \S+$/m, `prerelease: ${prerelease ? q('.' + patch + '-' + prerelease) : 'false'}`)
    return fsp.writeFile(DOCS_CONFIG_FILE, desc, 'utf8')
  })
}

function q (str) {
  return `'${str}'`
}

;(async () => {
  await updateDocsDesc()
})()

'use strict'

const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const { version } = require('../lerna.json')

const PROJECT_ROOT_DIR = path.join(__dirname, '..')
const CHANGELOG_FILE = path.join(PROJECT_ROOT_DIR, 'CHANGELOG.adoc')
const COMPONENT_VERSION_DESC = path.join(PROJECT_ROOT_DIR, 'docs/antora.yml')

function updateDocsVersion () {
  const minorVersion = version.split('.').slice(0, 2).join('.')
  const prereleaseSuffix = version.split('-').slice(1).join('-')
  return promisify(fs.readFile)(COMPONENT_VERSION_DESC, 'utf8')
    .then((desc) =>
      promisify(fs.writeFile)(
        COMPONENT_VERSION_DESC,
        desc
          .replace(/^version: \S+$/m, `version: ${q(minorVersion)}`)
          .replace(/^prerelease: \S+$/m, `prerelease: ${prereleaseSuffix ? q('-' + prereleaseSuffix) : 'false'}`),
        'utf8'
      )
    ).then(() =>
      promisify(exec)('git add docs/antora.yml', { cwd: PROJECT_ROOT_DIR })
    )
}

function updateChangelog() {
  const now = new Date()
  const currentDate = new Date(now - now.getTimezoneOffset() * 60000).toISOString().split('T')[0]
  return promisify(fs.readFile)(CHANGELOG_FILE, 'utf8')
    .then((changelog) =>
      promisify(fs.writeFile)(CHANGELOG_FILE, changelog.replace(/^== Unreleased$/m, `== ${version} (${currentDate})`))
    ).then(() =>
      promisify(exec)('git add CHANGELOG.adoc', { cwd: PROJECT_ROOT_DIR })
    )
}

function q (str) {
  return `'${str}'`
}

;(async () => {
  await updateDocsVersion()
  await updateChangelog()
})()

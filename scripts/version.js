'use strict'

const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const { version: VERSION } = require('../lerna.json')

const PROJECT_ROOT_DIR = path.join(__dirname, '..')
const CHANGELOG_FILE = path.join(PROJECT_ROOT_DIR, 'CHANGELOG.adoc')
const COMPONENT_VERSION_DESC = path.join(PROJECT_ROOT_DIR, 'docs/antora.yml')
const PACKAGES_DIR = path.join(PROJECT_ROOT_DIR, 'packages')
const PROJECT_README_FILE = path.join(PROJECT_ROOT_DIR, 'README.adoc')

function getCurrentDate () {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
}

function updateReadmes (now) {
  return promisify(fs.readdir)(PACKAGES_DIR, { withFileTypes: true })
    .then((dirents) =>
      Promise.all(
        dirents
          .reduce(
            (accum, dirent) =>
              dirent.isDirectory() ? accum.concat(path.join(PACKAGES_DIR, dirent.name, 'README.adoc')) : accum,
            [PROJECT_README_FILE]
          )
          .map((readmeFile) =>
            promisify(fs.readFile)(readmeFile, 'utf8').then((contents) =>
              promisify(fs.writeFile)(
                readmeFile,
                contents.replace(/^Copyright \(C\) (\d{4})-\d{4}/m, `Copyright (C) $1-${now.getFullYear()}`)
              )
            )
          )
      )
    )
    .then(() => promisify(exec)('git add README.adoc packages/*/README.adoc', { cwd: PROJECT_ROOT_DIR }))
}

function updateDocsConfig () {
  const minorVersion = VERSION.split('.')
    .slice(0, 2)
    .join('.')
  const prereleaseSuffix = VERSION.split('-')
    .slice(1)
    .join('-')
  return promisify(fs.readFile)(COMPONENT_VERSION_DESC, 'utf8')
    .then((desc) =>
      promisify(fs.writeFile)(
        COMPONENT_VERSION_DESC,
        desc
          .replace(/^version: \S+$/m, `version: ${q(minorVersion)}`)
          .replace(/^prerelease: \S+$/m, `prerelease: ${prereleaseSuffix ? q('-' + prereleaseSuffix) : 'false'}`),
        'utf8'
      )
    )
    .then(() => promisify(exec)('git add docs/antora.yml', { cwd: PROJECT_ROOT_DIR }))
}

function updateChangelog (now) {
  const releaseDate = now.toISOString().split('T')[0]
  return promisify(fs.readFile)(CHANGELOG_FILE, 'utf8')
    .then((changelog) =>
      promisify(fs.writeFile)(CHANGELOG_FILE, changelog.replace(/^== Unreleased$/m, `== ${VERSION} (${releaseDate})`))
    )
    .then(() => promisify(exec)('git add CHANGELOG.adoc', { cwd: PROJECT_ROOT_DIR }))
}

function q (str) {
  return `'${str}'`
}

;(async () => {
  const now = getCurrentDate()
  await updateReadmes(now)
  await updateDocsConfig()
  await updateChangelog(now)
})()

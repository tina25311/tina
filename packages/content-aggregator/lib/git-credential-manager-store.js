'use strict'

const { homedir } = require('os')
const expandPath = require('@antora/expand-path-helper')
const fs = require('fs-extra')
const ospath = require('path')

class GitCredentialManagerStore {
  configure ({ config, startDir }) {
    this.entries = undefined
    this.urls = {}
    if ((this.contents = (config = config || {}).contents)) {
      this.path = undefined
    } else if (config.path) {
      this.path = expandPath(config.path, '~+', startDir)
    } else {
      this.path = undefined
    }
    return this
  }

  async load () {
    if (this.entries) return this.entries
    return (this.entries = new Promise((resolve) => {
      let contentsPromise
      let delimiter = '\n'
      if (this.contents) {
        contentsPromise = Promise.resolve(this.contents)
        delimiter = /[,\n]/
      } else if (this.path) {
        contentsPromise = fs
          .pathExists(this.path)
          .then((exists) => (exists ? fs.readFile(this.path, 'utf8') : undefined))
      } else {
        const homeGitCredentialsPath = ospath.join(homedir(), '.git-credentials')
        const xdgConfigGitCredentialsPath = ospath.join(
          process.env.XDG_CONFIG_HOME || ospath.join(homedir(), '.config'),
          'git',
          'credentials'
        )
        contentsPromise = fs
          .pathExists(homeGitCredentialsPath)
          .then((exists) =>
            exists
              ? fs.readFile(homeGitCredentialsPath, 'utf8')
              : fs
                .pathExists(xdgConfigGitCredentialsPath)
                .then((altExists) => (altExists ? fs.readFile(xdgConfigGitCredentialsPath, 'utf8') : undefined))
          )
      }
      contentsPromise.then((contents) => {
        if (contents) {
          resolve(
            contents
              .trim()
              .split(delimiter)
              .reduce((accum, url) => {
                try {
                  const { username, password, hostname, pathname } = new URL(url)
                  let credentials
                  if (password) {
                    credentials = { username: decodeURIComponent(username), password: decodeURIComponent(password) }
                  } else if (username) {
                    credentials = { token: decodeURIComponent(username) }
                  } else {
                    return accum
                  }
                  if (pathname === '/') {
                    accum[hostname] = credentials
                  } else {
                    accum[hostname + pathname] = credentials
                    if (!pathname.endsWith('.git')) accum[hostname + pathname + '.git'] = credentials
                  }
                } catch (e) {}
                return accum
              }, {})
          )
        } else {
          resolve({})
        }
      })
    }))
  }

  async fill ({ url }) {
    this.urls[url] = 'requested'
    return this.load().then((entries) => {
      if (!Object.keys(entries).length) return
      const { hostname, pathname } = new URL(url)
      return entries[hostname + pathname] || entries[hostname]
    })
  }

  async approved ({ url }) {
    this.urls[url] = 'approved'
  }

  async rejected ({ url, auth }) {
    this.urls[url] = 'rejected'
    const statusCode = 401
    const statusMessage = 'HTTP Basic: Access Denied'
    const err = new Error(`HTTP Error: ${statusCode} ${statusMessage}`)
    err.name = err.code = 'HTTPError'
    err.data = { statusCode, statusMessage }
    if (auth) err.rejected = true
    throw err
  }

  status ({ url }) {
    return this.urls[url]
  }
}

module.exports = GitCredentialManagerStore

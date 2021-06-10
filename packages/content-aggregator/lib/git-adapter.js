'use strict'

const { GIT_CORE } = require('./constants')

module.exports = ((git$1) => {
  const cores = git$1.cores || (git$1.cores = new Map())
  const userAgent = `git/isomorphic-git@${git$1.version()}`
  const git = { cores, Errors: git$1.Errors }
  for (const name in git$1) {
    switch (name) {
      case 'clone':
      case 'fetch':
        git[name] = function (kwargs) {
          const plugins = cores.get(GIT_CORE)
          const extraKwargs = { fs: plugins.get('fs') }
          const url = kwargs.url
          if (url) {
            Object.assign(extraKwargs, { http: plugins.get('http'), headers: { 'user-agent': userAgent } })
            if (!(kwargs.noGitSuffix || url.endsWith('.git'))) kwargs = Object.assign({}, kwargs, { url: url + '.git' })
          }
          return this(Object.assign(extraKwargs, kwargs))
        }.bind(git$1[name])
        break
      case 'currentBranch':
      case 'getConfig':
      case 'listBranches':
      case 'listTags':
      case 'readBlob':
      case 'readObject':
      case 'readTree':
      case 'resolveRef':
      case 'setConfig':
        git[name] = function (kwargs) {
          const plugins = cores.get(GIT_CORE)
          return this(Object.assign({ fs: plugins.get('fs') }, kwargs))
        }.bind(git$1[name])
    }
  }
  return git
})(require('isomorphic-git').default)

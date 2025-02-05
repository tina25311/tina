'use strict'

const { posix: path } = require('node:path')

module.exports = (to, { data }) => {
  if (!to) return '#'
  if (to.charAt() !== '/') return to
  const from = data.root.page.url
  if (!from) return (data.root.site.path || '') + to
  let hash = ''
  const hashIdx = to.indexOf('#')
  if (~hashIdx) {
    hash = to.substr(hashIdx)
    to = to.substr(0, hashIdx)
  }
  if (to === from) return hash || (isDir(to) ? './' : path.basename(to))
  const rel = path.relative(path.dirname(from + '.'), to)
  return rel ? (isDir(to) ? rel + '/' : rel) + hash : (isDir(to) ? './' : '../' + path.basename(to)) + hash
}

function isDir (str) {
  return str.charAt(str.length - 1) === '/'
}

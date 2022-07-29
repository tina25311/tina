'use strict'

const logger = require('../logger')

const ATTR_REF_RX = /\{(\w[\w-]*)\}/g

function collateAsciiDocAttributes (scoped, { initial, merge, mdc }) {
  if (!scoped) return initial
  const locked = {}
  if (merge && initial) {
    Object.entries(initial).forEach(([name, val]) => {
      if (!(val ? val.constructor === String && val.charAt(val.length - 1) === '@' : val === false)) locked[name] = true
    })
  }
  let changed
  const collated = Object.entries(scoped).reduce(
    (accum, [name, val]) => {
      if (locked[name]) return accum
      if (val && val.constructor === String) {
        let alias
        val = val.replace(ATTR_REF_RX, (ref, refname) => {
          const refval = accum[refname]
          if (refval == null || refval === false) {
            if (refname in accum && ref === val) {
              alias = refval
            } else if (accum['attribute-missing'] === 'warn') {
              logger.warn(mdc, "Skipping reference to missing attribute '%s' in value of '%s' attribute", refname, name)
            }
            return ref
          } else if (refval.constructor === String) {
            const lastIdx = refval.length - 1
            return refval.charAt(lastIdx) === '@' ? refval.substr(0, lastIdx) : refval
          } else if (ref === val) {
            alias = refval
            return ref
          }
          return refval.toString()
        })
        if (alias !== undefined) val = alias
      }
      accum[name] = val
      changed = true
      return accum
    },
    merge ? Object.assign({}, initial) : initial || {}
  )
  return merge && !changed ? initial : collated
}

module.exports = collateAsciiDocAttributes

'use strict'

function collateAsciiDocAttributes (scoped, { initial, merge }) {
  if (!scoped) return initial
  let changed
  const locked = {}
  if (merge && initial) {
    Object.entries(initial).forEach(([name, val]) => {
      if (!(val ? val.constructor === String && val.charAt(val.length - 1) === '@' : val === false)) locked[name] = true
    })
  }
  const collated = Object.entries(scoped).reduce(
    (accum, [name, val]) => {
      if (locked[name]) return accum
      accum[name] = val
      changed = true
      return accum
    },
    merge ? Object.assign({}, initial) : initial || {}
  )
  return merge && !changed ? initial : collated
}

module.exports = collateAsciiDocAttributes

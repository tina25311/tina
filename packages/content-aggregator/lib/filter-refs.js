'use strict'

const { compile: bracesToGroup } = require('braces')
const { makeRe: makePicomatchRx } = require('picomatch')

function getPicomatchOpts (cache) {
  return {
    bash: true,
    dot: true,
    expandRange: (begin, end, step, opts) => {
      const pattern = opts ? `{${begin}..${end}..${step}}` : `{${begin}..${end}}`
      return cache.braces.get(pattern) || cache.braces.set(pattern, bracesToGroup(pattern)).get(pattern)
    },
    fastpaths: false,
    nobracket: true,
    noglobstar: true,
    noquantifiers: true,
    regex: false,
    strictSlashes: true,
  }
}

function compileRx (pattern, opts) {
  if (pattern === '*' || pattern === '**') return { test: () => true }
  return pattern.charAt() === '!' // do our own negate
    ? Object.defineProperty(makePicomatchRx(pattern.substr(1), opts), 'negated', { value: true })
    : makePicomatchRx(pattern, opts)
}

function createMatcher (patterns, cache) {
  let opts
  const rxs = patterns.map(
    (pattern) =>
      cache.get(pattern) ||
      cache.set(pattern, compileRx(pattern, opts || (opts = getPicomatchOpts(cache)))).get(pattern)
  )
  return (candidate) => {
    let first = true
    let matched
    for (const rx of rxs) {
      if (matched) {
        if (rx.negated && rx.test(candidate)) return
      } else if (first || !rx.negated) {
        matched = rx.test(candidate)
      }
      first = false
    }
    return matched
  }
}

function filterRefs (candidates, patterns, cache = Object.assign(new Map(), { braces: new Map() })) {
  const isMatch = createMatcher(patterns, cache)
  return candidates.reduce((accum, candidate) => {
    if (isMatch(candidate)) accum.push(candidate)
    return accum
  }, [])
}

module.exports = filterRefs

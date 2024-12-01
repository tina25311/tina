'use strict'

const { makeMatcherRx, refMatcherOpts: getMatcherOpts, MATCH_ALL_RX } = require('./matcher')

function compileRx (pattern, opts) {
  if (pattern === '*' || pattern === '**') return MATCH_ALL_RX
  const rx =
    pattern.charAt() === '!' // we handle negate ourselves
      ? Object.defineProperty(makeMatcherRx((pattern = pattern.substr(1)), opts), 'negated', { value: true })
      : makeMatcherRx(pattern, opts)
  return Object.defineProperty(rx, 'pattern', { value: pattern })
}

function createMatcher (patterns, cache = Object.assign(new Map(), { braces: new Map() })) {
  const rxs = patterns.map(
    (pattern) => cache.get(pattern) || cache.set(pattern, compileRx(pattern, getMatcherOpts(cache))).get(pattern)
  )
  if (rxs[0].negated) rxs.unshift(MATCH_ALL_RX)
  return (candidate, onMatch) => {
    let matched, symbolic
    for (const rx of rxs) {
      let voteIfMatched = true
      if (matched) {
        if (!rx.negated) continue
        voteIfMatched = false
      } else if (rx.negated) {
        continue
      }
      if (rx.test(candidate) || (symbolic && rx.test(symbolic) && (candidate = symbolic))) {
        if (onMatch) {
          if (!(matched = onMatch(candidate, rx))) continue
          ;[symbolic, candidate] = [candidate, matched]
        }
        matched = voteIfMatched && candidate
      }
    }
    return matched
  }
}

function filterRefs (candidates, patterns, cache, onMatch) {
  const match = createMatcher(patterns, cache)
  return candidates.reduce((accum, candidate) => {
    if ((candidate = match(candidate, onMatch))) accum.push(candidate)
    return accum
  }, [])
}

module.exports = filterRefs

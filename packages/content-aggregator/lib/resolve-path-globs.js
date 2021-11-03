'use strict'

const { expand: expandBraces, compile: bracesToGroup } = require('braces')
const flattenDeep = require('./flatten-deep')
const { promises: fsp } = require('fs')
const git = require('./git')
const invariably = { true: () => true, false: () => false, void: () => undefined, emptyArray: () => [] }
const { makeRe: makePicomatchRx } = require('picomatch')

const NON_GLOB_SPECIAL_CHARS_RX = /[.+?^${}()|[\]\\]/g
const RX_MAGIC_DETECTOR = /[*{]/
const RX_QUESTION_MARK = /\?/g
const PICOMATCH_OPTS = {
  expandRange: (begin, end, step, opts) => bracesToGroup(opts ? `{${begin}..${end}..${step}}` : `{${begin}..${end}}`),
  nobracket: true,
  noextglob: true,
  noglobstar: true,
  nonegate: true,
  noquantifiers: true,
  strictSlashes: true,
}
const PICOMATCH_NEGATED_OPTS = Object.assign({}, PICOMATCH_OPTS, { noglobstar: undefined })

function resolvePathGlobs (base, patterns, listDirents, retrievePath, tree = { path: '' }) {
  return patterns.reduce((paths, pattern) => {
    if (pattern.charAt() === '!') {
      return paths.then((resolvedPaths) => {
        if (resolvedPaths.length) {
          if (~pattern.indexOf('?')) pattern = pattern.replace(RX_QUESTION_MARK, '\\?')
          const rx = makePicomatchRx(pattern.substr(1), PICOMATCH_NEGATED_OPTS)
          return resolvedPaths.filter((it) => !rx.test(it))
        } else {
          return resolvedPaths
        }
      })
    } else if (RX_MAGIC_DETECTOR.test(pattern)) {
      return glob(base, pattern.split('/'), listDirents, retrievePath, tree).then((nestedPaths) =>
        paths.then((resolvedPaths) => [...resolvedPaths, ...nestedPaths])
      )
    }
    return paths.then((resolvedPaths) => [...resolvedPaths, pattern])
  }, Promise.resolve([]))
}

async function glob (base, patternSegments, listDirents, retrievePath, { oid, path, globbed }) {
  let patternSegment = patternSegments[0]
  patternSegments = patternSegments.slice(1)
  if (RX_MAGIC_DETECTOR.test(patternSegment)) {
    let isMatch
    let explicit
    if (patternSegment === '*') {
      isMatch = (it) => it.charAt() !== '.'
    } else if (~patternSegment.indexOf('{')) {
      if (globbed) {
        if (~patternSegment.indexOf('?')) patternSegment = patternSegment.replace(RX_QUESTION_MARK, '\\?')
        isMatch = (isMatch = makePicomatchRx(patternSegment, PICOMATCH_OPTS)).test.bind(isMatch)
      } else if (~patternSegment.indexOf('*')) {
        const [wildPatterns, literals] = expandBraces(patternSegment).reduce(
          ([wild, literal], it) => (~it.indexOf('*') ? [[...wild, it], literal] : [wild, [...literal, it]]),
          [[], []]
        )
        isMatch = (isMatch = makeAlternationMatcherRx(wildPatterns)).test.bind(isMatch)
        explicit = new Set(literals)
      } else {
        return expandBraces(patternSegment).map((it) => joinPath(path, it))
      }
    } else {
      isMatch = (isMatch = makeMatcherRx(patternSegment)).test.bind(isMatch)
    }
    let dirents = await listDirents(base, oid || path)
    if (explicit) dirents = dirents.filter((dirent) => !explicit.has(dirent.name))
    const discovered = flattenDeep(
      await Promise.all(
        dirents.map((dirent) =>
          dirent.isDirectory() && isMatch(dirent.name)
            ? patternSegments.length
              ? glob(base, patternSegments, listDirents, retrievePath, {
                oid: dirent.oid,
                path: joinPath(path, dirent.name),
                globbed: true,
              })
              : joinPath(path, dirent.name)
            : []
        )
      )
    )
    return explicit ? [...[...explicit].map((it) => joinPath(path, it)), ...discovered] : discovered
  } else {
    const [magicBase, nextSegment] = extractMagicBase(patternSegments, patternSegment)
    patternSegment = magicBase
    if (nextSegment) {
      const obj = await retrievePath(base, { oid, path }, patternSegment)
      if (obj) {
        return glob(base, patternSegments, listDirents, retrievePath, {
          oid: obj.oid,
          path: joinPath(path, patternSegment),
        })
      } else if ((patternSegment += '/' + patternSegments.join('/')).indexOf('{')) {
        return expandBraces(patternSegment).map((it) => joinPath(path, it))
      } else {
        return [joinPath(path, patternSegment)]
      }
    } else if (globbed) {
      return (await retrievePath(base, { oid, path }, patternSegment)) ? [joinPath(path, patternSegment)] : []
    } else {
      return [joinPath(path, patternSegment)]
    }
  }
}

function extractMagicBase (patternSegments, base) {
  let nextSegment
  if (patternSegments.length) {
    while ((nextSegment = patternSegments[0])) {
      if (RX_MAGIC_DETECTOR.test(nextSegment)) break
      base += '/' + patternSegments.shift()
    }
  }
  return [base, nextSegment]
}

function listDirentsFs (base, path) {
  return readdirWithFileTypes(base + '/' + path)
}

function listDirentsGit (repo, treeOid) {
  return git
    .readTree(Object.assign({ oid: treeOid, filepath: '' }, repo))
    .then(
      ({ tree: entries }) =>
        entries.map(({ type, oid, path: name }) => ({ name, oid, isDirectory: invariably[type === 'tree'] })),
      invariably.emptyArray
    )
}

function makeAlternationMatcherRx (patterns) {
  return new RegExp('^(?:' + patterns.map(patternToRx).join('|') + ')$')
}

function makeMatcherRx (pattern) {
  return new RegExp('^' + patternToRx(pattern) + '$')
}

function patternToRx (pattern) {
  return (pattern.charAt() === '.' ? '' : '(?!\\.)') + pattern
    .replace(NON_GLOB_SPECIAL_CHARS_RX, '\\$&')
    .replace('\\\\*', '\\x2a')
    .replace('*', '.*?')
}

function readdirWithFileTypes (dir) {
  return fsp.readdir(dir, { withFileTypes: true }).catch(invariably.emptyArray)
}

function retrievePathFs (base, { path }, subpath) {
  return fsp.access(base + '/' + joinPath(path, subpath)).then(invariably.true, invariably.false)
}

function retrievePathGit (repo, { oid }, filepath) {
  return git.readObject(Object.assign({ oid, filepath, format: 'deflated' }, repo)).catch(invariably.void)
}

function joinPath (parent, child) {
  return parent ? parent + '/' + child : child
}

module.exports = {
  fs: (baseDir, patterns) => resolvePathGlobs(baseDir, patterns, listDirentsFs, retrievePathFs),
  git: (repo, oid, patterns) => resolvePathGlobs(repo, patterns, listDirentsGit, retrievePathGit, { oid }),
}

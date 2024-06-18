'use strict'

const ospath = require('path')
const fs = require('fs')
const { promises: fsp } = fs
const http = require('isomorphic-git/http/node')
const git = ((git$1) => {
  if (!(git$1.cores || (git$1.cores = git$1.default.cores))) git$1.cores = git$1.default.cores = new Map()
  return git$1
})(require('isomorphic-git'))
const { globStream } = require('fast-glob')
const { pipeline, Writable } = require('stream')
const forEach = (write) => new Writable({ objectMode: true, write })
const yaml = require('js-yaml')

const FIXTURE_SRC_GLOB = '**/*.*'
const FIXTURE_SRC_OPTS = { braceExpansion: false, dot: true, unique: false }

class RepositoryBuilder {
  constructor (repoBase, fixtureBase, opts = {}) {
    if (!ospath.isAbsolute(repoBase)) {
      throw new Error('repoBase argument must be an absolute path')
    }
    if (!ospath.isAbsolute(fixtureBase)) {
      throw new Error('fixtureBase argument must be an absolute path')
    }
    this.repoBase = repoBase
    this.fixtureBase = fixtureBase
    if ((this.remote = !!opts.remote)) {
      this.gitServerProtocol = opts.remote.gitServerProtocol || 'http:'
      this.gitServerPort = opts.remote.gitServerPort || 60617
    }
    this.bare = opts.bare
    this.author = { name: 'Doc Writer', email: 'doc.writer@example.com' }
  }

  async init (repoName = 'test-repo', opts = {}) {
    this.url = this.repoPath = ospath.join(this.repoBase, repoName)
    if (this.remote) {
      // NOTE node-git-server requires path to end with file extension if present in URL (which isomorphic-git adds)
      this.repoPath += '.git'
      this.url = `${this.gitServerProtocol}//localhost:${this.gitServerPort}/${repoName}.git`
    } else if (this.bare) {
      this.url += ospath.sep + '.git'
    } else {
      this.local = ospath.join(this.repoPath, '.git')
    }
    const dir = this.repoPath
    const gitdir = ospath.join(dir, '.git')
    this.repository = { cache: {}, defaultBranch: opts.branch || 'main', dir, fs, gitdir, http }
    await git.init(this.repository)
    if (opts.empty) return this
    await (await this.addToWorktree('.gitignore')).addToWorktree('.gitattributes', '* text=auto eol=lf')
    // NOTE isomorphic-git doesn't require any commits to set up the default branch, but tests still rely on these files
    await git.commit({ ...this.repository, author: this.author, message: 'init' })
    return this.commitAll()
  }

  async open (repoName = undefined) {
    let dir
    let gitdir
    if (repoName) {
      this.repoPath = dir = ospath.join(this.repoBase, repoName)
      gitdir = ospath.join(dir, '.git')
      if (
        this.bare &&
        !(await fsp.stat(gitdir).then(
          (stat) => stat.isDirectory(),
          () => false
        ))
      ) {
        gitdir = dir
      }
    } else {
      if (!(dir = this.repoPath)) {
        throw new Error('No repository name specified and no previous repository was opened by this builder.')
      }
      gitdir = ospath.join(dir, '.git')
    }
    this.repository = { cache: {}, dir, fs, gitdir }
    await git.resolveRef({ ...this.repository, ref: 'HEAD', depth: 1 })
    return this
  }

  async checkoutBranch (branchName) {
    await git.branch({ ...this.repository, ref: branchName, checkout: true }).catch((err) => {
      if (err instanceof git.Errors.AlreadyExistsError) {
        return git.checkout({ ...this.repository, ref: branchName })
      }
      throw err
    })
    return this
  }

  async checkoutBranch$1 (branchName, ref = 'HEAD') {
    await git.branch({ ...this.repository, ref: branchName })
    await git.checkout({ ...this.repository, ref, noCheckout: true })
    // NOTE isomorphic-git writes oid to HEAD, but we want to test case when it's a ref
    await fsp.writeFile(ospath.join(this.repository.gitdir, 'HEAD'), `ref: refs/heads/${branchName}\n`)
    return this
  }

  async config (path_, value) {
    return git.setConfig({ ...this.repository, path: path_, value })
  }

  async deleteBranch (ref) {
    await git.deleteBranch({ ...this.repository, ref }).catch(() => {})
    return this
  }

  async addComponentDescriptorToWorktree (data) {
    const startPath = (this.startPath = data.startPath || '')
    const path_ = startPath ? ospath.join(startPath, 'antora.yml') : 'antora.yml'
    delete data.startPath
    if (!data.title && typeof data.name === 'string') {
      data.title = data.name
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.substr(1))
        .join(' ')
    }
    return this.addToWorktree(path_, yaml.dump(data))
  }

  async addComponentDescriptor (data) {
    return this.addComponentDescriptorToWorktree(data).then(() => this.commitAll('add component descriptor'))
  }

  async addToWorktree (path_, contents = '', symlink = false) {
    const to = ospath.join(this.repoPath, path_)
    const toDir = ospath.dirname(to)
    if (toDir !== this.repoPath) await fsp.mkdir(toDir, { recursive: true })
    if (symlink) {
      if (symlink === 'dir' && (contents === '.' || contents === '..')) {
        await fsp.symlink(contents, to, symlink)
        return this
      }
      const suffix = symlink === 'dir/' ? (symlink = 'dir') && '/' : ''
      const target =
        ospath.relative(toDir, ospath.isAbsolute(contents) ? contents : ospath.join(this.repoPath, contents)) + suffix
      await fsp.symlink(target, to, symlink)
    } else {
      await fsp.writeFile(to, contents)
    }
    return this
  }

  async copyToWorktree (paths, fromBase) {
    return Promise.all(
      paths.map((path_) => {
        const from = ospath.join(fromBase, path_)
        const to = ospath.join(this.repoPath, path_)
        // NOTE copy fixture file if exists, otherwise create an empty file
        return fsp
          .mkdir(ospath.dirname(to), { recursive: true })
          .then(() =>
            this.copyFile(from, to, { preserveSymlinks: process.platform !== 'win32' }).catch(() =>
              fsp.writeFile(to, '')
            )
          )
      })
    ).then(() => this)
  }

  async removeFromWorktree (paths) {
    if (!Array.isArray(paths)) paths = [paths]
    return Promise.all(paths.map((path_) => fsp.unlink(ospath.join(this.repoPath, path_)))).then(() => this)
  }

  async importFilesFromFixture (fixtureName = '', opts = {}) {
    return new Promise((resolve, reject) => {
      const cwd = ospath.join(this.fixtureBase, fixtureName)
      const exclude = opts.exclude && opts.exclude.map((path_) => ospath.normalize(path_))
      const paths = []
      pipeline(
        globStream(FIXTURE_SRC_GLOB, Object.assign({ cwd }, FIXTURE_SRC_OPTS)),
        forEach((relpath, _, done) => {
          relpath = ospath.sep === '\\' ? ospath.normalize(relpath) : relpath
          if (exclude && exclude.includes(relpath)) return done()
          const abspath = ospath.sep === '\\' ? ospath.join(cwd, relpath) : cwd + '/' + relpath
          fsp.stat(abspath).then(() => paths.push(relpath) && done(), done)
        }),
        (err) => (err ? reject(err) : this.addFilesFromFixture(paths, fixtureName).then(resolve, reject))
      )
    })
  }

  async addFilesFromFixture (paths, fixtureName = '', toStartPath = this.startPath) {
    if (!Array.isArray(paths)) paths = [paths]
    if (toStartPath) paths = paths.map((path_) => ospath.join(toStartPath, path_))
    await this.copyToWorktree(paths, ospath.join(this.fixtureBase, fixtureName))
    return this.commitAll('add fixtures')
  }

  async commitSelect (filepaths = [], message = 'make it so') {
    const repo = this.repository
    if (filepaths.length) await Promise.all(filepaths.map((filepath) => git.add({ ...repo, filepath })))
    await git.commit({ ...repo, author: this.author, message })
    return this
  }

  async commitBlob (filepath, contents, message = 'make it so') {
    const repo = this.repository
    const { tree: treeEntries } = await git.readTree({ ...repo, oid: await git.resolveRef({ ...repo, ref: 'HEAD' }) })
    const blob = await git.writeBlob({ ...repo, blob: Buffer.from(contents) })
    treeEntries.push({ mode: '100644', path: filepath, oid: blob })
    const tree = await git.writeTree({ ...repo, tree: treeEntries })
    await git.commit({ ...repo, author: this.author, tree, message })
    return this
  }

  async commitAll (message = 'make it so') {
    const repo = this.repository
    // NOTE emulates addAll
    await git.statusMatrix(repo).then((status) =>
      Promise.all(
        status.map(([filepath, _, worktreeStatus]) =>
          // NOTE sometimes isomorphic-git reports a changed file as unmodified, so always add if not removing
          git[worktreeStatus === 0 ? 'remove' : 'add']({ ...repo, filepath })
        )
      )
    )
    await git.commit({ ...repo, author: this.author, message })
    return this
  }

  async createTag (ref, object = 'HEAD', annotated = true) {
    if (annotated) {
      await git.annotatedTag({ ...this.repository, ref, object, tagger: this.author, message: ref, signature: '' })
    } else {
      await git.tag({ ...this.repository, ref, object })
    }
    return this
  }

  async deleteTag (ref) {
    await git.deleteTag({ ...this.repository, ref }).catch(() => {})
    return this
  }

  async addRemote (name, url, fetch = true) {
    await git.addRemote({ ...this.repository, remote: name, url })
    if (fetch) await git.fetch({ ...this.repository, corsProxy: false, remote: name })
    return this
  }

  async getHeadCommit () {
    return git.resolveRef({ ...this.repository, ref: 'HEAD' })
  }

  async detachHead (oid = undefined) {
    if (!oid) oid = await this.getHeadCommit()
    await git.checkout({ ...this.repository, ref: oid })
    return this
  }

  async findEntry (filepath, ref = 'HEAD') {
    return git.listFiles({ ...this.repository, ref }).then((files) => files.find((candidate) => candidate === filepath))
  }

  async resolveRef (ref = 'HEAD') {
    return git.resolveRef({ ...this.repository, ref })
  }

  getRefInfo (ref, remote = 'origin') {
    if (!ref) return
    return this.remote || this.bare ? ref : `${ref} <worktree>`
  }

  async close (branchName = undefined) {
    if (branchName) await git.checkout({ ...this.repository, ref: branchName })
    this.repository = undefined
    return this
  }

  // copy file, preserving file modes and, if the preserveSymlinks option is enabled, symlinks as well
  async copyFile (from, to, opts = {}) {
    return (opts.preserveSymlinks ? fsp.lstat : fsp.stat)(from).then((stat) =>
      stat.isSymbolicLink()
        ? fsp.readlink(from, 'utf8').then((target) => fsp.symlink(target, to))
        : fsp.copyFile(from, to).then(() => fsp.chmod(to, stat.mode))
    )
  }

  normalizePath (path_) {
    return this.bare || this.remote || ospath.sep === '/' ? path_ : ospath.normalize(path_)
  }

  joinPath (...pathSegments) {
    return pathSegments.join(this.bare || this.remote ? '/' : ospath.sep)
  }

  static clone (url, toDir) {
    return git.clone({ dir: toDir, fs, http, corsProxy: false, url })
  }

  static getPlugin (name, core = 'default') {
    return (git.cores.get(core) || new Map()).get(name)
  }

  static hasPlugin (name, core = 'default') {
    return (git.cores.get(core) || new Map()).has(name)
  }

  static registerPlugin (name, impl, core = 'default') {
    git.cores.has(core) ? git.cores.get(core).set(name, impl) : git.cores.set(core, new Map().set(name, impl))
  }

  static unregisterPlugin (name, core = 'default') {
    if (git.cores.has(core)) git.cores.get(core).delete(name)
  }
}

module.exports = RepositoryBuilder

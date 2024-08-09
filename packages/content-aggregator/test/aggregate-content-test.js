/* eslint-env mocha */
'use strict'

const {
  captureLog,
  closeServer,
  closeServers,
  expect,
  GitServer,
  heredoc,
  loadSslConfig,
  pathToFileURL,
  posixify,
  RepositoryBuilder,
  spy,
  trapAsyncError,
  wipeSync,
} = require('@antora/test-harness')

const aggregateContent = require('@antora/content-aggregator')
const computeOrigin = require('#compute-origin')
const { createHash } = require('crypto')
const { execFile } = require('child_process')
const fs = require('fs')
const { promises: fsp } = fs
const getCacheDir = require('cache-directory')
const http = require('http')
const net = require('net')
const { once } = require('events')
const os = require('os')
const ospath = require('path')
const { Readable } = require('stream')

const { COMPONENT_DESC_FILENAME, CONTENT_CACHE_FOLDER, GIT_CORE, GIT_OPERATION_LABEL_LENGTH } = require('#constants')
const CACHE_DIR = getCacheDir('antora-test')
const CONTENT_CACHE_DIR = ospath.join(CACHE_DIR, CONTENT_CACHE_FOLDER)
const CONTENT_REPOS_DIR = ospath.join(__dirname, 'content-repos')
const CWD = process.cwd()
const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')
const WORK_DIR = ospath.join(__dirname, 'work')

describe('aggregateContent()', () => {
  let gitServer
  let gitServerPort
  let playbookSpec

  const testAll = (testBlock, numRepoBuilders = 1, remoteBare = undefined) => {
    const createTest = (repoBuilderOpts) =>
      testBlock(
        ...Array(numRepoBuilders)
          .fill(undefined)
          .map(() => new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, repoBuilderOpts))
      )
    it('on local repo', () => createTest())
    it('on local bare repo', () => createTest({ bare: true }))
    it('on remote repo', () => createTest({ remote: { gitServerPort } }))
    if (remoteBare) it('on remote bare repo', () => createTest({ bare: true, remote: { gitServerPort } }))
  }

  const testLocal = (block) => it('on local repo', () => block(new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)))

  const testRemote = (block) =>
    it('on remote repo', () =>
      block(new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })))

  const initRepoWithFiles = async (repoBuilder, componentDesc, paths, beforeClose) => {
    let repoName
    if (componentDesc && 'repoName' in componentDesc) {
      repoName = componentDesc.repoName
      delete componentDesc.repoName
    }
    if (!componentDesc || !Object.keys(componentDesc).length) {
      componentDesc = { name: 'the-component', version: 'v1.2.3' }
    }
    if (paths) {
      if (!Array.isArray(paths)) paths = [paths]
    } else {
      paths = [
        'README.adoc',
        'modules/ROOT/_attributes.adoc',
        'modules/ROOT/pages/_attributes.adoc',
        'modules/ROOT/pages/page-one.adoc',
        'modules/ROOT/pages/page-two.adoc',
        'modules/ROOT/pages/topic-a/_attributes.adoc',
        'modules/ROOT/pages/topic-a/page-three.adoc',
      ]
    }
    return repoBuilder
      .init(repoName || componentDesc.name)
      .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
      .then(() => repoBuilder.addFilesFromFixture(paths))
      .then(() => beforeClose && beforeClose())
      .then(() => repoBuilder.close())
  }

  const deepFreeze = (o) => {
    for (const v of Object.values(o)) Object.isFrozen(v) || deepFreeze(v)
    return Object.freeze(o)
  }

  const prefixPath = (prefix, path_) => [prefix, path_].join(ospath.sep)

  const regexpEscape = (str) => str.replace(/[.*[\](|)\\]/g, '\\$&')

  const sortAggregate = (aggregate) => {
    aggregate.sort(
      ({ name: nameA, version: versionA }, { name: nameB, version: versionB }) =>
        nameA.localeCompare(nameB) || versionA.localeCompare(versionB)
    )
  }

  const generateCloneFolderName = (url) => {
    const normalizedUrl = (posixify ? posixify(url.toLowerCase()) : url.toLowerCase()).replace(
      /(?:(?:(?:\.git)?\/)?\.git|\/)$/,
      ''
    )
    return `${ospath.basename(normalizedUrl)}-${createHash('sha1').update(normalizedUrl).digest('hex')}.git`
  }

  const clean = (fin) => {
    process.chdir(CWD)
    wipeSync(CACHE_DIR)
    wipeSync(CONTENT_REPOS_DIR)
    wipeSync(WORK_DIR)
    if (!fin) {
      fs.mkdirSync(WORK_DIR, { recursive: true })
      process.chdir(WORK_DIR)
    }
  }

  const withMockStdout = async (testBlock, columns = 120, isTTY = true) => {
    const defaultStdout = 'clearLine columns cursorTo isTTY moveCursor write'.split(' ').reduce((accum, name) => {
      accum[name] = process.stdout[name]
      return accum
    }, {})
    try {
      const lines = []
      Object.assign(process.stdout, {
        clearLine: spy(() => {}),
        columns,
        cursorTo: spy(() => {}),
        isTTY,
        moveCursor: spy(() => {}),
        write: (line) => /\[(?:clone|fetch)\]/.test(line) && lines.push(line),
      })
      await testBlock(lines)
    } finally {
      Object.assign(process.stdout, defaultStdout)
    }
  }

  before(async () => {
    await new Promise((resolve, reject) =>
      (gitServer = new GitServer(CONTENT_REPOS_DIR, { autoCreate: false })).listen(0, { type: 'http' }, function (err) {
        err ? reject(err) : resolve((gitServerPort = this.address().port))
      })
    )
  })

  beforeEach(() => {
    playbookSpec = {
      runtime: { quiet: true },
      content: {
        sources: [],
        branches: ['HEAD', 'v{0..9}*'],
      },
    }
    clean()
  })

  after(async () => {
    await closeServer(gitServer.server)
    clean(true)
  })

  describe('read component descriptor', () => {
    const initRepoWithComponentDescriptor = async (repoBuilder, componentDesc, beforeClose) => {
      let repoName
      if ('repoName' in componentDesc) {
        repoName = componentDesc.repoName
        delete componentDesc.repoName
      } else {
        repoName = componentDesc.name
      }
      return repoBuilder
        .init(repoName)
        .then(() => repoBuilder.addComponentDescriptor(componentDesc))
        .then(() => beforeClose && beforeClose())
        .then(() => repoBuilder.close())
    }

    describe('should load component descriptor then remove file from aggregate', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          nav: ['nav-one.adoc', 'nav-two.adoc'],
        }
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
        const paths = aggregate[0].files.map((file) => file.path)
        expect(paths).to.not.include(COMPONENT_DESC_FILENAME)
      })
    })

    describe('should add origin of component descriptor to origins property on component version bucket and nav', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          nav: ['nav-one.adoc', 'nav-two.adoc'],
        }
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('origins')
        expect(aggregate[0]).not.to.have.property('origin')
        const origins = aggregate[0].origins
        expect(origins).to.have.lengthOf(1)
        expect(origins[0].refname).to.equal('main')
        expect(origins[0].descriptor).to.eql(componentDesc)
        expect(origins[0].descriptor).not.to.equal(componentDesc)
        expect(aggregate[0]).to.have.property('nav')
        expect(aggregate[0].nav).to.have.property('origin')
        expect(aggregate[0].nav.origin).to.equal(origins[0])
      })
    })

    describe('should not fail to add origin to nav if nav is not an array', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.2.3',
          nav: null,
        }
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('nav')
        expect(aggregate[0].nav).to.be.null()
      })
    })

    describe('should camelCase keys in component descriptor', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = {
          name: 'the-component',
          title: 'The Component',
          version: 'v1.0',
          display_version: 'Version 1.0 (Current release)',
          start_page: 'home.adoc',
        }
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('displayVersion', 'Version 1.0 (Current release)')
        expect(aggregate[0]).to.have.property('startPage', 'home.adoc')
      })
    })

    describe('should throw if component descriptor cannot be found in branch', () => {
      testAll(async (repoBuilder) => {
        await repoBuilder.init('the-component').then(() => repoBuilder.close())
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage = `${COMPONENT_DESC_FILENAME} not found in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should throw if component descriptor cannot be found in tag', () => {
      testAll(async (repoBuilder) => {
        await repoBuilder
          .init('the-component')
          .then(() => repoBuilder.createTag('v1.0.0'))
          .then(() => repoBuilder.close())
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: [], tags: 'v1.0.0' })
        const where = repoBuilder.local || repoBuilder.url
        const expectedMessage = `${COMPONENT_DESC_FILENAME} not found in ${where} (tag: v1.0.0)`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    it('should throw if component descriptor cannot be found in remote branch of local repository', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await repoBuilder
        .init('the-component')
        .then(() => repoBuilder.checkoutBranch('remote-branch'))
        .then(() => repoBuilder.close('main'))
      const clonePath = ospath.join(CONTENT_REPOS_DIR, 'clone')
      const cloneGitdir = ospath.join(clonePath, '.git')
      await RepositoryBuilder.clone(repoBuilder.url, clonePath)
      playbookSpec.content.sources.push({ url: clonePath, branches: 'remote-branch' })
      const expectedMessage = `${COMPONENT_DESC_FILENAME} not found in ${cloneGitdir} (branch: remote-branch <remotes/origin>)`
      expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
    })

    describe('should throw if component descriptor cannot be parsed', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: 'v1.0' }, () =>
          repoBuilder
            .addToWorktree('antora.yml', 'name: the-component\nversion: !!binary v1.0\n')
            .then(() => repoBuilder.commitAll('mangle component descriptor'))
        )
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage = new RegExp(
          `^${regexpEscape(COMPONENT_DESC_FILENAME)} has invalid syntax; unknown tag .*` +
            ` in ${regexpEscape(repoBuilder.url)} \\(branch: ${regexpEscape(ref)}\\)\n[\\s\\S]*version:`
        )
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should allow version to be coerced to string using !!str tag', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: 'v1.0' }, () =>
          repoBuilder
            .addToWorktree('antora.yml', 'name: the-component\nversion: !!str 1.0\n')
            .then(() => repoBuilder.commitAll('coerce version to string'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('name', 'the-component')
        expect(aggregate[0]).to.have.property('version', '1.0')
      })
    })

    describe('should throw if component descriptor is empty', () => {
      testAll(async (repoBuilder) => {
        await repoBuilder
          .init('the-component')
          .then(() => repoBuilder.addToWorktree('antora.yml', ''))
          .then(() => repoBuilder.commitAll('add empty component descriptor'))
          .then(() => repoBuilder.close('main'))
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage = `${COMPONENT_DESC_FILENAME} is missing a name in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should throw if component descriptor does not define name key', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { version: 'v1.0' })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage = `${COMPONENT_DESC_FILENAME} is missing a name in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should use refname as version if version key in component descriptor is true', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: true }, () =>
          repoBuilder.checkoutBranch('v/2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.branches = 'HEAD, v/*'
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', 'v-2.1')
      })
    })

    describe('should use refname as version if component descriptor does not define version key and content source sets version to true', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('v2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, version: true })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', 'v2.1')
      })
    })

    describe('should extract version from refname if version key in component descriptor is a pattern map', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: { 'v(?<version>+({0..9}).+({0..9})).x': '$<version>' } }
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.checkoutBranch('v2.1.x').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '2.1')
      })
    })

    // related to https://github.com/micromatch/picomatch/issues/100
    describe('should extract version from refname if version key is a pattern that starts with number followed by dot', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: { '2.(?<minor>+({0..9})).x': '2.$<minor>' } }
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.checkoutBranch('2.1.x').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: '2.1.x' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate[0]).to.have.property('version', '2.1')
      })
    })

    describe('should extract version from refname if component descriptor does not define version key and content source sets version to pattern map', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('v2.1.x').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          version: { 'v(?<version>+({0..9}).+({0..9})).x': '$<version>' },
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '2.1')
      })
    })

    describe('should extract version from refname with slash if component descriptor does not define version key and content source sets version to pattern map', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('version/ga/2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, version: { '*/(*)': '$1' } })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', 'ga-2.1')
      })
    })

    describe('should use refname as version if component descriptor does not define version key and version pattern on content source does not match', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('version/2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          version: { 'r/(?<version>*)': '$<version>', 'v(?<version>[0-9]*)': '$<version>' },
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', 'version-2.1')
      })
    })

    describe('should use refname as version if component descriptor does not define version key and version pattern on content source maps to match', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('v2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, version: { '*': '$&' } })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', 'v2.1')
      })
    })

    describe('should use next match if component descriptor does not define version key and previous version pattern on content source does not match', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('v2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          version: { 'v/(?<version>*)': '$<version>', '*': '' },
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '')
      })
    })

    describe('should allow use of negated match to map all other refnames to a derived version', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder
            .checkoutBranch('v1.0')
            .then(() => repoBuilder.checkoutBranch('v2.0'))
            .then(() => repoBuilder.checkoutBranch('main'))
            .then(() => repoBuilder.addComponentDescriptor({ name: 'the-component' }))
        )
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['v*', 'main'],
          version: { '!main': '$&', main: 'v3.0', '*': 'fail' },
        })
        const aggregate = await aggregateContent(playbookSpec)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.have.property('version', 'v1.0')
        expect(aggregate[1]).to.have.property('version', 'v2.0')
        expect(aggregate[2]).to.have.property('version', 'v3.0')
      })
    })

    describe('should use version derived from refname if version pattern contains a brace range with multi-digits numbers', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('v10.0').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          version: { 'v({1..10}).0': '$1' },
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '10')
      })
    })

    describe('should use version derived from refname if version pattern contains a brace range with step', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('v3.0').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          version: { 'v({1..9..2}).0': '$1' },
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '3')
      })
    })

    describe('should use refname as version if component descriptor does not define version key and version pattern on content source is invalid', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' }, () =>
          repoBuilder.checkoutBranch('v2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, version: { '(?<version>': '$<version>' } })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', 'v2.1')
      })
    })

    describe('should use non-empty version specified in component descriptor even if content source defines version', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '2_1' }, () =>
          repoBuilder.checkoutBranch('v2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, version: true })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '2_1')
      })
    })

    describe('should use empty version specified in component descriptor even if content source defines version', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '' }, () =>
          repoBuilder.checkoutBranch('v2.1').then(() => repoBuilder.deleteBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, version: true })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '')
      })
    })

    describe('should use version defined on content source if component descriptor does not have version key', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '1.0' }, () =>
          repoBuilder
            .checkoutBranch('v1.0')
            .then(() => repoBuilder.deleteBranch('main'))
            .then(() => repoBuilder.checkoutBranch('v2.0'))
            .then(() => repoBuilder.addComponentDescriptor({ name: 'the-component' }))
            .then(() => repoBuilder.checkoutBranch('v2.1.x'))
            .then(() => repoBuilder.addComponentDescriptor({ name: 'the-component', version: '2.1' }))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*', version: true })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        expect(aggregate[0]).to.have.property('version', '1.0')
        expect(aggregate[1]).to.have.property('version', 'v2.0')
        expect(aggregate[2]).to.have.property('version', '2.1')
      })
    })

    describe('should allow component descriptor to have a null version, which is coerced to empty string', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: null })
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '')
      })
    })

    describe('should allow component descriptor to have a 0 version', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: 0 })
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '0')
      })
    })

    describe('should throw if component descriptor has a false version', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: false })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage = `${COMPONENT_DESC_FILENAME} has an invalid version in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should allow component descriptor to have an empty version', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '' })
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.have.property('version', '')
      })
    })

    describe('should throw if component descriptor does not define version key and content source does not define version key', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component' })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage = `${COMPONENT_DESC_FILENAME} is missing a version in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should throw if name defined in component descriptor contains a path segment', () => {
      testLocal(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'foo/bar', version: 'v1.0' })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage =
          `name in ${COMPONENT_DESC_FILENAME} cannot have path segments: foo/bar` +
          ` in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should throw if version defined in component descriptor contains a path segment', () => {
      testLocal(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '1.1/0' })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage =
          `version in ${COMPONENT_DESC_FILENAME} cannot have path segments: 1.1/0` +
          ` in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should coerce name in component descriptor to string', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { repoName: 'the-component', name: 10, version: '1.0' })
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: '10', version: '1.0' })
      })
    })

    describe('should coerce version in component descriptor to string', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: 27 })
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: '27' })
      })
    })

    describe('should read component descriptor located at specified start path', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'path/to/docs'
        const componentDesc = {
          name: 'the-component',
          title: 'Component Title',
          version: '1.0',
          nav: ['nav-start.adoc', 'nav-end.adoc'],
          startPath,
        }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should throw if component descriptor at start path cannot be parsed', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: 'v1.0', startPath: 'docs' }
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder
            .addToWorktree('docs/antora.yml', ':\nname: the-component\nversion: v1.0\n')
            .then(() => repoBuilder.commitAll('mangle component descriptor'))
        )
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: 'docs' })
        const expectedMessage = new RegExp(
          `^${regexpEscape(COMPONENT_DESC_FILENAME)} has invalid syntax; .*` +
            ` in ${regexpEscape(repoBuilder.url)} \\(branch: ${regexpEscape(ref)} \\| start path: docs\\)\n`
        )
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should ignore leading, trailing, and repeating slashes in start path value', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'path/to/docs'
        const mangledStartPath = '/path//to/docs/'
        const componentDesc = { name: 'the-component', title: 'Component Title', version: '1.0', startPath }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: mangledStartPath })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should read component descriptor located at exact start paths', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'path/to/docs'
        const componentDesc = {
          name: 'the-component',
          title: 'Component Title',
          version: '1.0',
          nav: ['nav-start.adoc', 'nav-end.adoc'],
          startPath,
        }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: [startPath] })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should ignore leading, trailing, and repeating slashes in start paths', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'path/to/docs'
        const mangledStartPath = '/path//to/docs/'
        const componentDesc = { name: 'the-component', title: 'Component Title', version: '1.0', startPath }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: [mangledStartPath] })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should resolve start path from wildcard pattern', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'docs'
        const componentDesc = { name: 'the-component', title: 'Component Title', version: '1.0', startPath }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'doc*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should not match dot folders when resolving start paths from match all wildcard pattern', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'docs'
        const startPath2 = '.docs'
        const componentDesc = { name: 'a-component', title: 'A Component', version: '1.0', startPath }
        const componentDesc2 = { name: 'b-component', title: 'B Component', version: '1.0', startPath: startPath2 }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder
            .addComponentDescriptor(componentDesc2)
            .then(() => repoBuilder.commitAll('add component descriptor in dot folder'))
            .then(() => repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry)))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: '*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should not match dot folders when resolving start paths from match specific wildcard pattern', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'docs'
        const startPath2 = '.docs'
        const componentDesc = { name: 'a-component', title: 'A Component', version: '1.0', startPath }
        const componentDesc2 = { name: 'b-component', title: 'B Component', version: '1.0', startPath: startPath2 }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder
            .addComponentDescriptor(componentDesc2)
            .then(() => repoBuilder.commitAll('add component descriptor in dot folder'))
            .then(() => repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry)))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: '*ocs' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should read component descriptors located at start paths specified as CSV string', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs'
        const startPath2 = 'moredocs'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: startPath2 }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: [startPath1, startPath2].join(', ') })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
      })
    })

    describe('should read component descriptors located at start paths specified as array', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs'
        const startPath2 = 'more/docs'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: startPath2 }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: [startPath1, startPath2] })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
      })
    })

    describe('should read component descriptors located at start paths specified as brace pattern', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs'
        const startPath2 = 'moredocs'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: startPath2 }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: `{${startPath1},${startPath2}}` })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
      })
    })

    describe('should anchor start paths specified as brace pattern with wildcards to start of filename', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs'
        const startPath2 = 'moredocs'
        const startPath3 = 'nodocs'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: startPath2 }
        const componentDesc3 = { name: 'not-these', title: 'Not These', version: '1', startPath: startPath3 }
        let componentDescEntry1
        let componentDescEntry2
        let componentDescEntry3
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc3))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
            componentDescEntry3 = await repoBuilder.findEntry(startPath3 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        expect(componentDescEntry3).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: '{more*,doc*}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
      })
    })

    describe('should read component descriptors at start paths specified as nested brace patterns', () => {
      testAll(async (repoBuilder) => {
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: 'docs' }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: 'docx' }
        const componentDesc3 = { name: 'the-component', title: 'Component Title', version: '3', startPath: 'moredocs' }
        let componentDescEntry1
        let componentDescEntry2
        let componentDescEntry3
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc3))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry('docs/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry('docx/antora.yml')
            componentDescEntry3 = await repoBuilder.findEntry('moredocs/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        expect(componentDescEntry3).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: '{doc{s,x},more*}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
        expect(aggregate[2]).to.deep.include(componentDesc3)
      })
    })

    describe('should resolve start paths that follow wildcard in start paths pattern', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'path/to/docs'
        const startPath2 = 'more/docs'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: startPath2 }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        const startPaths = ['path/*/docs', '*/docs', '*/dne', '*/{does-,}not-exist']
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
      })
    })

    describe('should resolve start paths from pattern that contains a range following a wildcard', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs/v19'
        const startPath2 = 'docs/v20'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '19', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '20', startPath: startPath2 }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'doc*/v{1..20}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
      })
    })

    describe('should resolve start paths from pattern that contains a range following a wildcard, number, and dot', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs/2.1'
        const startPath2 = 'docs/3.0'
        const componentDesc1 = {
          name: 'the-component',
          title: 'Component Title',
          version: '2.1',
          startPath: startPath1,
        }
        const componentDesc2 = {
          name: 'the-component',
          title: 'Component Title',
          version: '3.0',
          startPath: startPath2,
        }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'doc*/3.{0..9}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc2)
      })
    })

    describe('should resolve start paths from pattern that contains a range with step following a wildcard', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs/v8'
        const startPath2 = 'docs/v9'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '8', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '9', startPath: startPath2 }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'doc*/v{0..8..2}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc1)
      })
    })

    describe('should resolve start paths with pattern that uses a wildcard and matches a segment that starts with !', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs/!extra'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        let componentDescEntry1
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'doc*/!extra{-docs,}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc1)
      })
    })

    if (process.platform !== 'win32') {
      describe('should resolve start paths with pattern that uses a wildcard and matches a segment that contains *', () => {
        testAll(async (repoBuilder) => {
          if (!(repoBuilder.remote || repoBuilder.bare)) return
          const startPath1 = 'docs*extra'
          const startPath2 = 'docs-extra'
          const componentDesc1 = {
            name: 'the-component',
            title: 'Component Title',
            version: '1',
            startPath: startPath1,
          }
          const componentDesc2 = {
            name: 'the-component',
            title: 'Component Title',
            version: '2',
            startPath: startPath2,
          }
          let componentDescEntry1
          let componentDescEntry2
          await repoBuilder
            .init(componentDesc1.name)
            .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
            .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
            .then(async () => {
              componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
              componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
            })
            .then(() => repoBuilder.close())
          expect(componentDescEntry1).to.exist()
          expect(componentDescEntry2).to.exist()
          playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'docs\\*extra' })
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.deep.include(componentDesc1)
        })
      })
    }

    describe('should resolve start paths using extglob', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'doc-0'
        const startPath2 = 'docs-8'
        const startPath3 = 'docs-101'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: startPath2 }
        const componentDesc3 = { name: 'the-component', title: 'Component Title', version: '3', startPath: startPath3 }
        let componentDescEntry1
        let componentDescEntry2
        let componentDescEntry3
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc3))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
            componentDescEntry3 = await repoBuilder.findEntry(startPath3 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        expect(componentDescEntry3).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'doc?(s)-{0,{1..9}*({0..9})}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
        expect(aggregate[2]).to.deep.include(componentDesc3)
      })
    })

    describe('should exclude start paths using extglob', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', title: 'Component Title', version: '1', startPath: 'docs' }
        let componentDescEntry
        await initRepoWithFiles(repoBuilder, componentDesc, undefined, () =>
          repoBuilder
            .findEntry('docs/antora.yml')
            .then((entry) => (componentDescEntry = entry))
            .then(() => repoBuilder.addToWorktree('src/hello.rb', 'puts 1'))
            .then(() => repoBuilder.commitAll('add file'))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: ['*', '!!(docs)'] })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should match dot folders if wildcard pattern in brace pattern begins with dot', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'docs'
        const startPath2 = '.docs'
        const componentDesc = { name: 'a-component', title: 'A Component', version: '1.0', startPath }
        const componentDesc2 = { name: 'b-component', title: 'B Component', version: '1.0', startPath: startPath2 }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder
            .addComponentDescriptor(componentDesc2)
            .then(() => repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry)))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: '{d*,.d*}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc)
        expect(aggregate[1]).to.deep.include(componentDesc2)
      })
    })

    describe('should not read component descriptors located at start paths that have been excluded', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs'
        const startPath2 = 'more/docs'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: startPath2 }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: '*docs*, !more*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc1)
      })
    })

    describe('should not read component descriptors located at nested start paths that have been excluded', () => {
      testAll(async (repoBuilder) => {
        const startPath1 = 'docs'
        const startPath2 = 'path/to/more/docs'
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: '1', startPath: startPath1 }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: '2', startPath: startPath2 }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry(startPath1 + '/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry(startPath2 + '/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'docs, path/to/more/docs, !*/docs' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc1)
      })
    })

    describe('should read component descriptors located at start paths in each reference', () => {
      testAll(async (repoBuilder) => {
        const componentDesc1v1 = { name: 'component-a', title: 'Component A', version: '1', startPath: 'docs' }
        const componentDesc1v2 = { name: 'component-a', title: 'Component A', version: '2', startPath: 'docs' }
        const componentDesc2v8 = { name: 'component-b', title: 'Component B', version: '8', startPath: 'moredocs' }
        const componentDesc2v9 = { name: 'component-b', title: 'Component B', version: '9', startPath: 'moredocs' }
        let componentDescEntry1v1
        let componentDescEntry1v2
        let componentDescEntry2v8
        let componentDescEntry2v9
        await repoBuilder
          .init('hybrid')
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1v1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2v8))
          .then(async () => {
            componentDescEntry1v1 = await repoBuilder.findEntry('docs/antora.yml')
            componentDescEntry2v8 = await repoBuilder.findEntry('moredocs/antora.yml')
          })
          .then(() => repoBuilder.checkoutBranch('other'))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1v2))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2v9))
          .then(async () => {
            componentDescEntry1v2 = await repoBuilder.findEntry('docs/antora.yml')
            componentDescEntry2v9 = await repoBuilder.findEntry('moredocs/antora.yml')
          })
          .then(() => repoBuilder.close('main'))
        expect(componentDescEntry1v1).to.exist()
        expect(componentDescEntry1v2).to.exist()
        expect(componentDescEntry2v8).to.exist()
        expect(componentDescEntry2v9).to.exist()
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['main', 'other'],
          startPaths: ['docs', 'moredocs'],
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(4)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1v1)
        expect(aggregate[1]).to.deep.include(componentDesc1v2)
        expect(aggregate[2]).to.deep.include(componentDesc2v8)
        expect(aggregate[3]).to.deep.include(componentDesc2v9)
      })
    })

    describe('should throw if start path is not found', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '1.0' })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: 'does-not-exist' })
        const expectedMessage = `the start path 'does-not-exist' does not exist in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should throw if start path at reference is not a directory', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '1.0' })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: 'antora.yml' })
        const expectedMessage = `the start path 'antora.yml' is not a directory in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should throw if component descriptor cannot be found at start path', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithFiles(repoBuilder)
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: 'modules' })
        const expectedMessage = `${COMPONENT_DESC_FILENAME} not found in ${repoBuilder.url} (branch: ${ref} | start path: modules)`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should throw if a start path specified in a brace pattern does not exist', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'docs'
        const componentDesc = { name: 'the-component', title: 'Component Title', version: '1.0', startPath }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        const ref = repoBuilder.getRefInfo('main')
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: '{more,}docs' })
        const expectedMessage = `the start path 'moredocs' does not exist in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should not expand brace pattern with a single entry', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'docs'
        const componentDesc = { name: 'the-component', title: 'Component Title', version: '1.0', startPath }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        expect(componentDescEntry).to.exist()
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'doc{s}' })
        const expectedMessage = `the start path 'doc{s}' does not exist in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should not expand negated brace pattern with a single entry', () => {
      testAll(async (repoBuilder) => {
        const startPath = 'docs'
        const componentDesc = { name: 'the-component', title: 'Component Title', version: '1.0', startPath }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'docs, !doc{s}' })
        let aggregate
        expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
        expect(aggregate).to.have.lengthOf(1)
      })
    })

    describe('should throw if no start paths are resolved', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '1.0' })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'does-not-exist-*' })
        const expectedMessage = `no start paths found in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    it('should throw if no start paths are resolved in remote branch of local repository', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '1.0' }, () =>
        repoBuilder.checkoutBranch('remote-branch').then(() => repoBuilder.close('main'))
      )
      const clonePath = ospath.join(CONTENT_REPOS_DIR, 'clone')
      const cloneGitdir = ospath.join(clonePath, '.git')
      await RepositoryBuilder.clone(repoBuilder.url, clonePath)
      playbookSpec.content.sources.push({ url: clonePath, branches: 'remote-branch', startPaths: 'does-not-exist-*' })
      const expectedMessage = `no start paths found in ${cloneGitdir} (branch: remote-branch <remotes/origin>)`
      expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
    })

    describe('should retain unresolved segments in start path if parent directory does not exist', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithComponentDescriptor(repoBuilder, { name: 'the-component', version: '1.0' })
        const ref = repoBuilder.getRefInfo('main')
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: 'does-not-exist/{foo,bar*}' })
        const expectedMessage = new RegExp(
          "^the start path 'does-not-exist/(foo|bar\\*)' does not exist in " +
            `${regexpEscape(repoBuilder.url)} \\(branch: ${regexpEscape(ref)}\\)$`
        )
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should coerce value of start path to string', () => {
      testAll(async (repoBuilder) => {
        const startPath = '10'
        const componentDesc = { name: 'the-component', title: 'Component', version: 'v10', startPath }
        let componentDescEntry
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc, () =>
          repoBuilder.findEntry(startPath + '/antora.yml').then((entry) => (componentDescEntry = entry))
        )
        expect(componentDescEntry).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: parseInt(startPath, 10) })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include(componentDesc)
      })
    })

    describe('should coerce value of each start path to string', () => {
      testAll(async (repoBuilder) => {
        const componentDesc1 = { name: 'the-component', title: 'Component Title', version: 'v10', startPath: '10' }
        const componentDesc2 = { name: 'the-component', title: 'Component Title', version: 'v20', startPath: 'true' }
        let componentDescEntry1
        let componentDescEntry2
        await repoBuilder
          .init(componentDesc1.name)
          .then(() => repoBuilder.addComponentDescriptor(componentDesc1))
          .then(() => repoBuilder.addComponentDescriptor(componentDesc2))
          .then(async () => {
            componentDescEntry1 = await repoBuilder.findEntry('10/antora.yml')
            componentDescEntry2 = await repoBuilder.findEntry('true/antora.yml')
          })
          .then(() => repoBuilder.close())
        expect(componentDescEntry1).to.exist()
        expect(componentDescEntry2).to.exist()
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPaths: [10, true] })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.deep.include(componentDesc1)
        expect(aggregate[1]).to.deep.include(componentDesc2)
      })
    })

    describe('should discover different components across multiple repositories', () => {
      testAll(async (repoBuilderA, repoBuilderB) => {
        const componentDescA = { name: 'the-component', title: 'The Component', version: 'v1.2' }
        await initRepoWithComponentDescriptor(repoBuilderA, componentDescA)
        playbookSpec.content.sources.push({ url: repoBuilderA.url })

        const componentDescB = { name: 'the-other-component', title: 'The Other Component', version: 'v3.4' }
        await initRepoWithComponentDescriptor(repoBuilderB, componentDescB)
        playbookSpec.content.sources.push({ url: repoBuilderB.url })

        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include(componentDescA)
        expect(aggregate[1]).to.include(componentDescB)
      }, 2)
    })

    // FIXME this test may change if we modify the rules for merging component descriptors
    describe('should discover the same component version across multiple repositories', () => {
      testAll(async (repoBuilderA1, repoBuilderA2) => {
        const componentDescA1 = { name: 'the-component', title: 'The Component', version: 'v1.2' }
        await initRepoWithComponentDescriptor(repoBuilderA1, componentDescA1)
        playbookSpec.content.sources.push({ url: repoBuilderA1.url })

        const componentDescA2 = {
          name: 'the-component',
          repoName: 'the-component-repo-2',
          version: 'v1.2',
          prerelease: true,
        }
        await initRepoWithComponentDescriptor(repoBuilderA2, componentDescA2)
        playbookSpec.content.sources.push({ url: repoBuilderA2.url })

        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        // NOTE the keys of the two component descriptors are merged, last wins
        expect(aggregate[0]).to.include({ ...componentDescA1, ...componentDescA2 })
      }, 2)
    })

    describe('should be able to scan the same repository twice', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', title: 'The Component', version: 'v1.2' }
        await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
        playbookSpec.content.sources.push({ url: repoBuilder.url }, { url: repoBuilder.url })

        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include(componentDesc)
      })
    })

    it('should resolve relative repository path starting from cwd', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const componentDesc = {
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
      }
      await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      playbookSpec.dir = WORK_DIR
      playbookSpec.content.sources.push({ url: ospath.relative(newWorkDir, repoBuilder.url) })
      let aggregate
      expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include(componentDesc)
    })

    it('should resolve dot-relative repository path starting from playbook dir if set', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const componentDesc = {
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
      }
      await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
      playbookSpec.content.sources.push({ url: prefixPath('.', ospath.relative(WORK_DIR, repoBuilder.url)) })
      playbookSpec.dir = WORK_DIR
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      let aggregate
      expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include(componentDesc)
    })

    it('should resolve dot-relative repository path start from cwd if playbook dir not set', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const componentDesc = {
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
      }
      await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
      playbookSpec.content.sources.push({ url: prefixPath('.', ospath.relative(WORK_DIR, repoBuilder.url)) })
      let aggregate
      expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include(componentDesc)
    })

    it('should expand leading ~ segment in local repository path to user home', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const componentDesc = {
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
      }
      await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
      playbookSpec.content.sources.push({ url: prefixPath('~', ospath.relative(os.homedir(), repoBuilder.url)) })
      let aggregate
      expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include(componentDesc)
    })

    it('should expand leading ~+ segment in repository path to cwd', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const componentDesc = {
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
      }
      await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      playbookSpec.dir = WORK_DIR
      playbookSpec.content.sources.push({ url: prefixPath('~+', ospath.relative(newWorkDir, repoBuilder.url)) })
      let aggregate
      expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include(componentDesc)
    })

    it('should disregard playbook dir if repository path is absolute', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const componentDesc = {
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
      }
      await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      playbookSpec.dir = WORK_DIR
      const newWorkDir = ospath.join(WORK_DIR, 'some-other-folder')
      fs.mkdirSync(newWorkDir, { recursive: true })
      process.chdir(newWorkDir)
      let aggregate
      expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include(componentDesc)
    })

    it('should ignore trailing slash on repository path when start path is not set', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const componentDesc = {
        name: 'the-component',
        title: 'The Component',
        version: 'v1.2.3',
      }
      await initRepoWithComponentDescriptor(repoBuilder, componentDesc)
      playbookSpec.content.sources.push({ url: ospath.join(repoBuilder.url, '/') })
      let aggregate
      expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include(componentDesc)
    })
  })

  describe('filter refs', () => {
    const initRepoWithBranches = async (repoBuilder, componentName = 'the-component', beforeClose) =>
      repoBuilder
        .init(componentName)
        .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: 'latest-and-greatest' }))
        .then(() => repoBuilder.checkoutBranch('v1.0'))
        .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: 'v1.0' }))
        .then(() => repoBuilder.checkoutBranch('v3.0'))
        .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: 'v3.0' }))
        .then(() => repoBuilder.checkoutBranch('v2.0'))
        .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: 'v2.0' }))
        .then(() => beforeClose && beforeClose())
        .then(() => repoBuilder.close('main'))

    describe('should exclude all branches when global filter is undefined', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.branches = undefined
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.be.empty()
      })
    })

    describe('should exclude all branches when filter on content source is undefined', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: undefined })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.be.empty()
      })
    })

    describe('should filter branches by exact name', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
      })
    })

    describe('should select a branch that matches a numeric value', () => {
      testAll(async (repoBuilder) => {
        const componentName = 'the-component'
        await initRepoWithBranches(repoBuilder, componentName, () =>
          repoBuilder
            .checkoutBranch('5.6')
            .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '5.6' }))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 5.6 })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: componentName, version: '5.6' })
      })
    })

    describe('should not inadvertently select a branch named push', () => {
      testAll(async (repoBuilder) => {
        const componentName = 'the-component'
        await initRepoWithBranches(repoBuilder, componentName, () =>
          repoBuilder
            .checkoutBranch('push')
            .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: 'push' }))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v1.0' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: componentName, version: 'v1.0' })
      })
    })

    describe('should log info message if only branches are specified yet none are found', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: ['nope', 'nada'], startPath: 'docs' })
        const expectedMessage = `No matching references found for content source entry (url: ${repoBuilder.url} | branches: [nope, nada] | start path: docs)`
        const { messages, returnValue: aggregate } = (
          await captureLog(() => aggregateContent(playbookSpec))
        ).withReturnValue()
        expect(aggregate).to.be.empty()
        expect(messages).to.have.lengthOf(1)
        expect(messages[0]).to.deep.include({
          level: 'info',
          msg: expectedMessage,
        })
      })
    })

    describe('should log info message if start paths and only branches are specified yet none are found', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'maint/*', startPaths: 'docu*' })
        const expectedMessage = `No matching references found for content source entry (url: ${repoBuilder.url} | branches: maint/* | start paths: docu*)`
        const { messages, returnValue: aggregate } = (
          await captureLog(() => aggregateContent(playbookSpec))
        ).withReturnValue()
        expect(aggregate).to.be.empty()
        expect(messages).to.have.lengthOf(1)
        expect(messages[0]).to.deep.include({
          level: 'info',
          msg: expectedMessage,
        })
      })
    })

    describe('should not include start paths detail in info message about no references if start path is falsy', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'no-such-ref', startPath: '' })
        const expectedMessage = `No matching references found for content source entry (url: ${repoBuilder.url} | branches: no-such-ref)`
        const { messages, returnValue: aggregate } = (
          await captureLog(() => aggregateContent(playbookSpec))
        ).withReturnValue()
        expect(aggregate).to.be.empty()
        expect(messages).to.have.lengthOf(1)
        expect(messages[0]).to.deep.include({
          level: 'info',
          msg: expectedMessage,
        })
      })
    })

    describe('should include all branches when pattern is wildcard', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: '*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate.map((it) => it.version)).to.have.members(['latest-and-greatest', 'v3.0', 'v2.0', 'v1.0'])
      })
    })

    describe('should filter branches using trailing wildcard', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter branches with nested path segments using wildcard', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.checkoutBranch('v3.0'))
          .then(() => repoBuilder.checkoutBranch('release/stable/3.0'))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'release/*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter branches using brace expression with set', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        // NOTE if pattern contains '{', then pattern is only split on ',' if followed by a space
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v{3,2,1}.0' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter branches using brace expression with range', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.checkoutBranch('main'))
          .then(() => repoBuilder.checkoutBranch('v10.0'))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v{1..10}.0' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(4)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[3]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter branches using brace expression with repeating range', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.checkoutBranch('main'))
          .then(() => repoBuilder.checkoutBranch('v10.0'))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v+({0..9}).0' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(4)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[3]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter branches using brace expression with nested range', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: '{v+({0..9}).*,ma*}' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(4)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[3]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter branches using brace expression with stepped range', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.checkoutBranch('main'))
          .then(() => repoBuilder.checkoutBranch('v10.0'))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v{2..10..2}.0' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
      })
    })

    // related to https://github.com/micromatch/picomatch/issues/100
    describe('should filter branches when pattern starts with number followed by dot and contains brace expression', () => {
      testAll(async (repoBuilder) => {
        const componentName = 'the-component'
        await repoBuilder
          .init(componentName)
          .then(() => repoBuilder.checkoutBranch('2.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '2.0' }))
          .then(() => repoBuilder.checkoutBranch('3.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '3.0' }))
          .then(() => repoBuilder.checkoutBranch('3.1.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '3.1' }))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: '3.{0..9}.x' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: '3.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: '3.1' })
      })
    })

    // related to https://github.com/micromatch/picomatch/issues/100
    describe('should filter branches when pattern starts with word characters followed by dot and contains brace expression', () => {
      testAll(async (repoBuilder) => {
        const componentName = 'the-component'
        await repoBuilder
          .init(componentName)
          .then(() => repoBuilder.checkoutBranch('rev_2.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '2.0' }))
          .then(() => repoBuilder.checkoutBranch('rev_3.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '3.0' }))
          .then(() => repoBuilder.checkoutBranch('rev_3.1.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '3.1' }))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'rev_3.{0..9}.x' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: '3.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: '3.1' })
      })
    })

    // related to https://github.com/micromatch/picomatch/issues/100
    describe('should filter branches when negated pattern starts with number followed by dot and contains brace expression', () => {
      testAll(async (repoBuilder) => {
        const componentName = 'the-component'
        await repoBuilder
          .init(componentName)
          .then(() => repoBuilder.checkoutBranch('2.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '2.0' }))
          .then(() => repoBuilder.checkoutBranch('3.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '3.0' }))
          .then(() => repoBuilder.checkoutBranch('3.1.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '3.1' }))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: '*.x, !2.{0..9}.x' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: '3.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: '3.1' })
      })
    })

    // related to https://github.com/micromatch/picomatch/issues/100
    describe('should filter branches when negated pattern starts with word characters followed by dot and contains brace expression', () => {
      testAll(async (repoBuilder) => {
        const componentName = 'the-component'
        await repoBuilder
          .init(componentName)
          .then(() => repoBuilder.checkoutBranch('r2.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '2.0' }))
          .then(() => repoBuilder.checkoutBranch('r3.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '3.0' }))
          .then(() => repoBuilder.checkoutBranch('r3.1.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: componentName, version: '3.1' }))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: '*.x, !r2.{0..9}.x' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: '3.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: '3.1' })
      })
    })

    describe('should filter branches using multiple filters passed as array', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['main', 'v1*', 'v3.*', 5.6],
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter branches using multiple filters passed as CSV string', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: 'main,v1* , v3.*',
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should apply branch exclusion filter to matched branches', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['v*', '!main', '!v2*'],
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should include all branches if filter starts with exclusion, then apply exclusion filter', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['!main'],
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should include branches after branches have been excluded', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['v*', '!v*.0', 'v3.*'],
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should ignore exclusion if no branches have been matched by initial filter', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['release/*', '!main', 'v3.*'],
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should apply branch exclusion filter with brace expressions', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['v*', '!ma{ster,in}', '!v{2..10..2}.?'],
        })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should only use branches when only branches are specified', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () => repoBuilder.createTag('v1.0.0', 'v1.0'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter branches using default filter as array', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        playbookSpec.content.branches = ['v1.0', 'v2*']
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
      })
    })

    describe('should filter branches using default filter as string', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        playbookSpec.content.branches = 'v1.*'
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
      })
    })

    describe('should allow current branch to be selected', () => {
      it('should select current branch if pattern is HEAD', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.close('v3.0'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD' })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
      })

      it('should select current branch if pattern is .', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.close('v3.0'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: '.' })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
      })

      it('should select current branch if pattern includes HEAD', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.close('v3.0'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: ['main', 'HEAD'] })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })

      it('should select current branch if pattern includes .', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.close('v3.0'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: ['main', '.'] })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })

      it('should select current branch if CSV pattern includes HEAD', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.close('v3.0'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main,HEAD' })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })

      it('should select current branch if CSV pattern includes .', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.close('v3.0'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main,.' })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })

      // this test verifies that the default branch is used if the repository is bare (local or remote clone)
      describe('should select default branch if pattern is HEAD', () => {
        testAll(
          async (repoBuilder) => {
            await initRepoWithBranches(repoBuilder)
              .then(() => repoBuilder.open())
              .then(() => repoBuilder.deleteBranch('main'))
              .then(() => repoBuilder.checkoutBranch('v3.0'))
              .then(() => repoBuilder.checkoutBranch('main'))
              .then(() => repoBuilder.deleteBranch('v3.0'))
              .then(() => repoBuilder.close('main'))
            playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD' })
            deepFreeze(playbookSpec)
            const aggregate = await aggregateContent(playbookSpec)
            expect(aggregate).to.have.lengthOf(1)
            expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
          },
          1,
          true
        )
      })

      describe('should select default branch if pattern is HEAD regardless of branch name', () => {
        testAll(
          async (repoBuilder) => {
            await initRepoWithBranches(repoBuilder)
              .then(() => repoBuilder.open())
              .then(() => repoBuilder.deleteBranch('main'))
              .then(() => repoBuilder.deleteBranch('v1.0'))
              .then(() => repoBuilder.deleteBranch('v2.0'))
              .then(() => repoBuilder.checkoutBranch('v3.0'))
              .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-one.adoc'))
              .then(() => repoBuilder.checkoutBranch('default'))
              .then(() => repoBuilder.deleteBranch('v3.0'))
              .then(() => repoBuilder.close('default'))
            playbookSpec.content.sources.push({ url: repoBuilder.url })
            deepFreeze(playbookSpec)
            const aggregate = await aggregateContent(playbookSpec)
            expect(aggregate).to.have.lengthOf(1)
            expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
            expect(aggregate[0].files[0]).to.have.nested.property('src.origin.branch', 'default')
          },
          1,
          true
        )
      })

      it('should resolve branches pattern HEAD to worktree if repository is on branch', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const componentDesc = { name: 'the-component', version: '3.0' }
        await initRepoWithFiles(repoBuilder, componentDesc, 'modules/ROOT/pages/page-one.adoc', () => {
          return repoBuilder
            .checkoutBranch('v3.0.x')
            .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-two.adoc', '= Page Two\n\ncontent\n'))
        })
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD' })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const expectedPaths = ['modules/ROOT/pages/page-one.adoc', 'modules/ROOT/pages/page-two.adoc']
        expect(aggregate[0]).to.include(componentDesc)
        const files = aggregate[0].files
        expect(files).to.have.lengthOf(expectedPaths.length)
        const page = files.find((it) => it.relative === 'modules/ROOT/pages/page-one.adoc')
        expect(page.src.abspath).to.equal(ospath.join(repoBuilder.url, page.relative))
        expect(page.src.origin.worktree).to.equal(repoBuilder.url)
      })

      it('should resolve branches pattern HEAD to current branch in git tree if worktrees is falsy or empty', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const componentDesc = { name: 'the-component', version: '3.0' }
        await initRepoWithFiles(repoBuilder, componentDesc, 'modules/ROOT/pages/page-one.adoc', () => {
          return repoBuilder
            .checkoutBranch('v3.0.x')
            .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-two.adoc', '= Page Two\n\ncontent\n'))
        })
        for (const worktrees of [false, null, [], '']) {
          playbookSpec.content.sources = [{ url: repoBuilder.url, branches: 'HEAD', worktrees }]
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          const expectedPaths = ['modules/ROOT/pages/page-one.adoc']
          expect(aggregate[0]).to.include(componentDesc)
          expect(aggregate[0].files).to.have.lengthOf(expectedPaths.length)
          expect(aggregate[0].files[0].src.origin.worktree).to.be.false()
        }
      })

      it('should resolve branches pattern HEAD to current branch in git index if worktrees is *', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const componentDesc = { name: 'the-component', version: '3.0' }
        await initRepoWithFiles(repoBuilder, componentDesc, 'modules/ROOT/pages/page-one.adoc', () => {
          return repoBuilder
            .checkoutBranch('v3.0.x')
            .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-two.adoc', '= Page Two\n\ncontent\n'))
        })
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD', worktrees: '*' })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const expectedPaths = ['modules/ROOT/pages/page-one.adoc']
        expect(aggregate[0]).to.include(componentDesc)
        expect(aggregate[0].files).to.have.lengthOf(expectedPaths.length)
      })

      it('should use worktree if branches pattern is HEAD and HEAD is detached', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.checkoutBranch('v3.0'))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-one.adoc', '= Page One\n\ncontent\n'))
          .then(() => repoBuilder.detachHead())
          .then(() => repoBuilder.close())
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD' })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
        const page = aggregate[0].files.find((it) => it.relative === 'modules/ROOT/pages/page-one.adoc')
        expect(page.src.abspath).to.equal(ospath.join(repoBuilder.url, page.relative))
        expect(page.src.origin.worktree).to.equal(repoBuilder.url)
      })

      it('should use worktree if branches pattern contains HEAD and HEAD is detached', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.checkoutBranch('v3.0'))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-one.adoc', '= Page One\n\ncontent\n'))
          .then(() => repoBuilder.detachHead())
          .then(() => repoBuilder.close())
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: ['HEAD', 'v1.0', 'v2.0'] })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
        const page = aggregate[2].files.find((it) => it.relative === 'modules/ROOT/pages/page-one.adoc')
        expect(page.src.abspath).to.equal(ospath.join(repoBuilder.url, page.relative))
        expect(page.src.origin.worktree).to.equal(repoBuilder.url)
      })

      it('should bypass worktree if branches pattern is HEAD, HEAD is detached, and worktrees is false', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.checkoutBranch('v3.0'))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-one.adoc'))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-two.adoc', '= Page Two\n\ncontent\n'))
          .then(() => repoBuilder.detachHead())
          .then(() => repoBuilder.close())
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD', worktrees: false })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v3.0' })
        const files = aggregate[0].files
        const pageOne = files.find((it) => it.relative === 'modules/ROOT/pages/page-one.adoc')
        const pageTwo = files.find((it) => it.relative === 'modules/ROOT/pages/page-two.adoc')
        expect(pageOne.src.abspath).to.be.undefined()
        expect(pageOne.src.origin.worktree).to.be.false()
        expect(pageTwo).to.be.undefined()
      })

      it('should bypass worktree if branches pattern contains HEAD, HEAD is detached, and worktrees is false', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
          .then(() => repoBuilder.open())
          .then(() => repoBuilder.checkoutBranch('v3.0'))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-one.adoc'))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-two.adoc', '= Page Two\n\ncontent\n'))
          .then(() => repoBuilder.detachHead())
          .then(() => repoBuilder.close())
        playbookSpec.content.sources.push({
          url: repoBuilder.url,
          branches: ['HEAD', 'v1.0', 'v2.0'],
          worktrees: false,
        })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
        const files = aggregate[2].files
        const pageOne = files.find((it) => it.relative === 'modules/ROOT/pages/page-one.adoc')
        const pageTwo = files.find((it) => it.relative === 'modules/ROOT/pages/page-two.adoc')
        expect(pageOne.src.abspath).to.be.undefined()
        expect(pageOne.src.origin.worktree).to.be.false()
        expect(pageTwo).to.be.undefined()
      })

      it('should only select branch once if both HEAD and current branch name are listed', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: ['HEAD', 'main'] })
        deepFreeze(playbookSpec)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
      })
    })

    describe('should filter tags using wildcard', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('v1.0.0', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('z3.0.0', 'v3.0'))
        )
        playbookSpec.content.branches = undefined
        playbookSpec.content.sources.push({ url: repoBuilder.url, tags: 'v*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
      })
    })

    describe('should filter tags using exact name', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('v1.0.0', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
        )
        playbookSpec.content.branches = undefined
        playbookSpec.content.sources.push({ url: repoBuilder.url, tags: 'v2.0.0' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v2.0' })
      })
    })

    describe('should select a tag that matches a numeric value', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () => repoBuilder.createTag('1', 'v1.0'))
        playbookSpec.content.branches = undefined
        playbookSpec.content.sources.push({ url: repoBuilder.url, tags: 1 })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
      })
    })

    describe('should filter tags using multiple filters passed as array', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('1', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
        )
        playbookSpec.content.branches = undefined
        playbookSpec.content.sources.push({ url: repoBuilder.url, tags: [1, 'v3.*'] })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should filter tags using multiple filters passed as CSV string', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('v1.0.0', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
        )
        playbookSpec.content.branches = undefined
        playbookSpec.content.sources.push({ url: repoBuilder.url, tags: 'v1.0.0 , v3.*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should exclude all refs if filter matches no tags', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('v1.0.0', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
        )
        playbookSpec.content.branches = undefined
        playbookSpec.content.sources.push({ url: repoBuilder.url, tags: 'z*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.be.empty()
      })
    })

    describe('should log info message if only tags are specified yet none are found', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder)
        playbookSpec.content.branches = undefined
        playbookSpec.content.sources.push({ url: repoBuilder.url, tags: ['nope', 'nada'], startPath: 'docs' })
        const expectedMessage = `No matching references found for content source entry (url: ${repoBuilder.url} | tags: [nope, nada] | start path: docs)`
        const { messages, returnValue: aggregate } = (
          await captureLog(() => aggregateContent(playbookSpec))
        ).withReturnValue()
        expect(aggregate).to.be.empty()
        expect(messages).to.have.lengthOf(1)
        expect(messages[0]).to.deep.include({
          level: 'info',
          msg: expectedMessage,
        })
      })
    })

    describe('should filter tags using default filter as string', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('v1.0.0', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
        )
        playbookSpec.content.branches = []
        playbookSpec.content.tags = 'v2.*'
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v2.0' })
      })
    })

    describe('should filter tags using default filter as array', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('v1.0.0', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
        )
        playbookSpec.content.branches = []
        playbookSpec.content.tags = ['v1.*', 'v3.0.0']
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    describe('should exclude all refs if filter on content source is undefined', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('v1.0.0', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
        )
        playbookSpec.content.branches = undefined
        playbookSpec.content.tags = 'v*'
        playbookSpec.content.sources.push({ url: repoBuilder.url, tags: undefined })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.be.empty()
      })
    })

    describe('should filter both branches and tags', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithBranches(repoBuilder, 'the-component', () =>
          repoBuilder
            .createTag('v1.0.0', 'v1.0')
            .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
            .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: ['v3.*'], tags: ['v*', '!v3.*'] })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
        expect(aggregate[2]).to.include({ name: 'the-component', version: 'v3.0' })
      })
    })

    it('should select tags even when branches filter is HEAD', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      await initRepoWithBranches(repoBuilder, 'the-component', () =>
        repoBuilder
          .createTag('v1.0.0', 'v1.0')
          .then(() => repoBuilder.createTag('v2.0.0', 'v2.0'))
          .then(() => repoBuilder.createTag('v3.0.0', 'v3.0'))
      )
      await repoBuilder
        .open()
        .then(() => repoBuilder.detachHead())
        .then(() => repoBuilder.close())
      playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD', tags: 'v3*' })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(2)
      sortAggregate(aggregate)
      expect(aggregate[0]).to.include({ name: 'the-component', version: 'latest-and-greatest' })
      expect(aggregate[1]).to.include({ name: 'the-component', version: 'v3.0' })
    })
  })

  describe('aggregate files from repository', () => {
    describe('should aggregate all files in branch', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithFiles(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: 'v1.2.3' })
        const expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
          'modules/ROOT/pages/page-two.adoc',
          'modules/ROOT/pages/topic-a/_attributes.adoc',
          'modules/ROOT/pages/topic-a/page-three.adoc',
        ]
        const files = componentVersion.files
        expect(files).to.have.lengthOf(expectedPaths.length)
        const paths = files.map((file) => file.path)
        const relatives = files.map((file) => file.relative)
        expect(paths).to.have.members(expectedPaths)
        expect(relatives).to.have.members(expectedPaths)
        files.forEach((file) => expect(file.stat.isFile()).to.be.true())
        if (repoBuilder.bare || repoBuilder.remote) {
          files.forEach((file) => expect(file.stat.mtime).to.be.undefined())
        } else {
          files.forEach((file) => {
            expect(file.stat.mtime).to.not.be.undefined()
            expect(file.stat.mtime.getTime()).to.not.be.NaN()
          })
        }
      })
    })

    describe('should aggregate all files in annotated tag', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: '1.0' }
        const paths = ['modules/ROOT/pages/page-one.adoc', 'modules/ROOT/pages/page-two.adoc']
        await repoBuilder
          .init(componentDesc.name)
          .then(() => repoBuilder.checkoutBranch('v1.0.x'))
          .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
          .then(() => repoBuilder.addFilesFromFixture(paths))
          .then(() => repoBuilder.createTag('v1.0.0'))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: [], tags: 'v*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include(componentDesc)
        const files = componentVersion.files
        expect(files).to.have.lengthOf(paths.length)
        files.forEach((file) => expect(file.stat.isFile()).to.be.true())
        files.forEach((file) => expect(file).to.have.nested.property('src.origin.tag', 'v1.0.0'))
      })
    })

    describe('should aggregate all files in lightweight tag', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: '1.0' }
        const paths = ['modules/ROOT/pages/page-one.adoc', 'modules/ROOT/pages/page-two.adoc']
        await repoBuilder
          .init(componentDesc.name)
          .then(() => repoBuilder.checkoutBranch('v1.0.x'))
          .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
          .then(() => repoBuilder.addFilesFromFixture(paths))
          .then(() => repoBuilder.createTag('v1.0.0', 'HEAD', false))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: [], tags: 'v*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include(componentDesc)
        const files = componentVersion.files
        expect(files).to.have.lengthOf(paths.length)
        files.forEach((file) => expect(file.stat.isFile()).to.be.true())
        files.forEach((file) => expect(file).to.have.nested.property('src.origin.tag', 'v1.0.0'))
      })
    })

    // NOTE in the future, files in the worktree of a local repo may get picked up in this scenario
    describe('should handle repository with no commits as expected', () => {
      testAll(async (repoBuilder) => {
        let trapInfo
        try {
          if (repoBuilder.remote) {
            gitServer.on(
              'info',
              (trapInfo = (info) => {
                // git/2.43.0 broadcasts capabilities when no refs; force old response until fixed in isomorphic-git
                info.res.setHeader('content-type', 'application/x-git-upload-pack-advertisement')
                info.res.end('001e# service=git-upload-pack\n0000')
              })
            )
          }
          const componentDesc = { name: 'the-component', version: 'v1.0' }
          await repoBuilder
            .init(componentDesc.name, { empty: true })
            .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
            .then(() => repoBuilder.copyToWorktree(['modules/ROOT/pages/page-one.adoc'], repoBuilder.fixtureBase))
            .then(() => repoBuilder.close())
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD' })
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.be.empty()
        } finally {
          if (trapInfo) gitServer.off('info', trapInfo)
        }
      })
    })

    describe('should populate files with correct contents', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithFiles(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        const pageOne = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(pageOne.contents.toString()).to.equal(
          heredoc`
          = Page One
          ifndef::env-site,env-github[]
          include::_attributes.adoc[]
          endif::[]
          :keywords: foo, bar

          Hey World!
          ` + '\n'
        )
      })
    })

    it('should populate origin info for remote branch of local repository', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder, undefined, ['modules/ROOT/pages/page-one.adoc'], () =>
        repoBuilder.checkoutBranch('remote-branch').then(() => repoBuilder.close('main'))
      )
      const clonePath = ospath.join(CONTENT_REPOS_DIR, 'clone')
      await RepositoryBuilder.clone(repoBuilder.url, clonePath)
      playbookSpec.content.sources.push({ url: clonePath, branches: 'remote-branch' })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
      const origins = aggregate[0].origins
      expect(origins).to.have.lengthOf(1)
      const origin = origins[0]
      expect(origin.branch).to.equal('remote-branch')
      expect(origin.remote).to.equal('origin')
      expect(origin.worktree).to.be.false()
      expect(aggregate[0].files).to.have.lengthOf(1)
      expect(aggregate[0].files[0].path).to.equal('modules/ROOT/pages/page-one.adoc')
    })

    describe('should fail to read file with path that refers to location outside of repository', () => {
      testRemote(async (repoBuilder) => {
        const maliciousPath = 'modules/ROOT/pages/../../../../the-page.adoc'
        await initRepoWithFiles(repoBuilder, undefined, ['modules/ROOT/pages/page-one.adoc'], async () =>
          repoBuilder.commitBlob(maliciousPath, '= Page Title')
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const expectedMessage = `The filepath "${maliciousPath}" contains unsafe character sequences`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    describe('should set file mode of regular file read from git repository to correct value', () => {
      testAll(async (repoBuilder) => {
        const fixturePath = 'modules/ROOT/pages/page-one.adoc'
        await initRepoWithFiles(repoBuilder, {}, fixturePath, () => {
          return repoBuilder
            .checkoutBranch('v2.0')
            .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: 'v2.0' }))
            .then(() => repoBuilder.commitAll())
            .then(() => repoBuilder.checkoutBranch('main'))
        })
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*' })
        const expectedMode = 0o100666 & ~process.umask()
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v2.0' })
        const fixtureFile = aggregate[0].files.find((file) => file.path === fixturePath)
        expect(fixtureFile).to.exist()
        if (repoBuilder.remote) {
          expect(fixtureFile.src.origin.worktree).to.be.undefined()
        } else {
          expect(fixtureFile.src.origin.worktree).to.be.false()
        }
        expect(fixtureFile.stat.mode).to.equal(expectedMode)
      })
    })

    it('should set file mode of regular file read from worktree to correct value', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const fixturePath = 'modules/ROOT/pages/page-one.adoc'
      await initRepoWithFiles(repoBuilder, {}, fixturePath)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedMode = (await fsp.stat(ospath.join(repoBuilder.repoPath, fixturePath))).mode
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
      const fixtureFile = aggregate[0].files.find((file) => file.path === fixturePath)
      expect(fixtureFile).to.exist()
      expect(fixtureFile.src.origin.worktree).to.equal(repoBuilder.repoPath)
      expect(fixtureFile.stat.mode).to.equal(expectedMode)
    })

    describe('should set file mode of executable file read from git repository to correct value', () => {
      testAll(async (repoBuilder) => {
        const fixturePath = 'modules/ROOT/attachments/installer.sh'
        await initRepoWithFiles(repoBuilder, {}, fixturePath, () => {
          return repoBuilder
            .checkoutBranch('v2.0')
            .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: 'v2.0' }))
            .then(() => repoBuilder.commitAll())
            .then(() => repoBuilder.checkoutBranch('main'))
        })
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*' })
        // NOTE Windows doesn't support setting executable bit on file (and can't current emulate in git server)
        const expectedMode = (process.platform === 'win32' ? 0o100666 : 0o100777) & ~process.umask()
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v2.0' })
        const fixtureFile = aggregate[0].files.find((file) => file.path === fixturePath)
        expect(fixtureFile).to.exist()
        if (repoBuilder.remote) {
          expect(fixtureFile.src.origin.worktree).to.be.undefined()
        } else {
          expect(fixtureFile.src.origin.worktree).to.be.false()
        }
        expect(fixtureFile.stat.mode).to.equal(expectedMode)
      })
    })

    it('should set file mode of executable file read from worktree to correct value', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
      const fixturePath = 'modules/ROOT/attachments/installer.sh'
      await initRepoWithFiles(repoBuilder, {}, fixturePath)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedMode = (await fsp.stat(ospath.join(repoBuilder.repoPath, fixturePath))).mode
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
      const fixtureFile = aggregate[0].files.find((file) => file.path === fixturePath)
      expect(fixtureFile).to.exist()
      expect(fixtureFile.src.origin.worktree).to.equal(repoBuilder.repoPath)
      expect(fixtureFile.stat.mode).to.equal(expectedMode)
    })

    if (process.platform !== 'win32' && process.getuid()) {
      it('should report file path if file from worktree cannot be read', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const fixturePath = 'modules/ROOT/attachments/installer.sh'
        await initRepoWithFiles(repoBuilder, {}, fixturePath)
        await fsp.chmod(ospath.join(repoBuilder.repoPath, fixturePath), 0o000)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const { messages, returnValue: aggregate } = (
          await captureLog(() => aggregateContent(playbookSpec))
        ).withReturnValue()
        expect(aggregate).to.have.lengthOf(1)
        expect(messages).to.have.lengthOf(1)
        expect(messages[0]).to.deep.include({
          level: 'error',
          file: {
            path: ospath.join(repoBuilder.repoPath, fixturePath),
          },
          source: {
            reftype: 'branch',
            refname: 'main',
            worktree: repoBuilder.repoPath,
            local: repoBuilder.local,
            url: pathToFileURL(repoBuilder.url),
          },
          msg: `EACCES: permission denied, open ${fixturePath}`,
        })
      })
    }

    describe('resolve symlinks', () => {
      describe('should resolve file symlink to sibling file', () => {
        testAll(async (repoBuilder) => {
          const targetPath = 'modules/ROOT/pages/page-one.adoc'
          const symlinkPath = 'modules/ROOT/pages/page-one-link.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, {}, fixturePaths, () =>
            repoBuilder.addToWorktree(symlinkPath, targetPath, 'file').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const expectedMode =
            repoBuilder.remote || repoBuilder.bare
              ? 0o100666 & ~process.umask()
              : (await fsp.stat(ospath.join(repoBuilder.repoPath, targetPath))).mode
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const symlinkPage = aggregate[0].files.find((file) => file.path === symlinkPath)
          expect(symlinkPage).to.exist()
          expect(symlinkPage.symlink).to.not.exist()
          expect(symlinkPage.stat.mode).to.equal(expectedMode)
          expect(symlinkPage.contents).to.deep.equal(expectedContents)
          if (repoBuilder.remote) {
            expect(symlinkPage.src.origin.worktree).to.be.undefined()
          } else if (repoBuilder.bare) {
            expect(symlinkPage.src.origin.worktree).to.be.false()
          }
        })
      })

      describe('should resolve file symlink to file in parent directory', () => {
        testAll(async (repoBuilder) => {
          const targetPath = 'modules/ROOT/pages/page-one.adoc'
          const symlinkPath = 'modules/ROOT/pages/topic-c/page-one-link.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, {}, fixturePaths, () =>
            repoBuilder.addToWorktree(symlinkPath, targetPath, 'file').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const expectedMode =
            repoBuilder.remote || repoBuilder.bare
              ? 0o100666 & ~process.umask()
              : (await fsp.stat(ospath.join(repoBuilder.repoPath, targetPath))).mode
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const symlinkPage = aggregate[0].files.find((file) => file.path === symlinkPath)
          expect(symlinkPage).to.exist()
          expect(symlinkPage.symlink).to.not.exist()
          expect(symlinkPage.stat.mode).to.equal(expectedMode)
          expect(symlinkPage.contents).to.deep.equal(expectedContents)
          if (repoBuilder.remote) {
            expect(symlinkPage.src.origin.worktree).to.be.undefined()
          } else if (repoBuilder.bare) {
            expect(symlinkPage.src.origin.worktree).to.be.false()
          }
        })
      })

      describe('should resolve file symlink to file in child directory', () => {
        testAll(async (repoBuilder) => {
          const targetPath = 'modules/ROOT/pages/topic-c/page-one.adoc'
          const symlinkPath = 'modules/ROOT/pages/page-one-link.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, {}, fixturePaths, () =>
            repoBuilder.addToWorktree(symlinkPath, targetPath, 'file').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const expectedMode =
            repoBuilder.remote || repoBuilder.bare
              ? 0o100666 & ~process.umask()
              : (await fsp.stat(ospath.join(repoBuilder.repoPath, targetPath))).mode
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const symlinkPage = aggregate[0].files.find((file) => file.path === symlinkPath)
          expect(symlinkPage).to.exist()
          expect(symlinkPage.symlink).to.not.exist()
          expect(symlinkPage.stat.mode).to.equal(expectedMode)
          expect(symlinkPage.contents).to.deep.equal(expectedContents)
          if (repoBuilder.remote) {
            expect(symlinkPage.src.origin.worktree).to.be.undefined()
          } else if (repoBuilder.bare) {
            expect(symlinkPage.src.origin.worktree).to.be.false()
          }
        })
      })

      describe('should resolve symlink when content source defines a start path', () => {
        testAll(async (repoBuilder) => {
          const startPath = 'docs'
          const componentDesc = { name: 'the-component', version: '1.0', startPath }
          const targetPath = 'modules/ROOT/pages/page-one.adoc'
          const symlinkPath = 'modules/ROOT/pages/topic-c/page-one-link.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, componentDesc, fixturePaths, () =>
            repoBuilder
              .addToWorktree(startPath + '/' + symlinkPath, startPath + '/' + targetPath, 'file')
              .then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main', startPath })
          const expectedMode =
            repoBuilder.remote || repoBuilder.bare
              ? 0o100666 & ~process.umask()
              : (await fsp.stat(ospath.join(repoBuilder.repoPath, startPath, targetPath))).mode
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, startPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: '1.0' })
          const symlinkPage = aggregate[0].files.find((file) => file.path === symlinkPath)
          expect(symlinkPage).to.exist()
          expect(symlinkPage.symlink).to.not.exist()
          expect(symlinkPage.stat.mode).to.equal(expectedMode)
          expect(symlinkPage.contents).to.deep.equal(expectedContents)
          if (repoBuilder.remote) {
            expect(symlinkPage.src.origin.worktree).to.be.undefined()
          } else if (repoBuilder.bare) {
            expect(symlinkPage.src.origin.worktree).to.be.false()
          }
        })
      })

      describe('should resolve symlink to symlink', () => {
        testAll(async (repoBuilder) => {
          const targetPath = 'modules/ROOT/pages/page-one.adoc'
          const symlink1Path = 'modules/ROOT/pages/topic-c/page-one-link.adoc'
          const symlink2Path = 'modules/ROOT/pages/page-one-link.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, {}, fixturePaths, () =>
            repoBuilder
              .addToWorktree(symlink1Path, targetPath, 'file')
              .then(() => repoBuilder.addToWorktree(symlink2Path, symlink1Path, 'file'))
              .then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const expectedMode =
            repoBuilder.remote || repoBuilder.bare
              ? 0o100666 & ~process.umask()
              : (await fsp.stat(ospath.join(repoBuilder.repoPath, targetPath))).mode
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const page = aggregate[0].files.find((file) => file.path === symlink2Path)
          expect(page).to.exist()
          expect(page.symlink).to.not.exist()
          expect(page.stat.mode).to.equal(expectedMode)
          expect(page.contents).to.deep.equal(expectedContents)
          if (repoBuilder.remote) {
            expect(page.src.origin.worktree).to.be.undefined()
          } else if (repoBuilder.bare) {
            expect(page.src.origin.worktree).to.be.false()
          }
        })
      })

      describe('should resolve files inside directory symlink', () => {
        testAll(async (repoBuilder) => {
          const targetDir = 'modules/ROOT/pages/topic-a'
          const targetPath = 'modules/ROOT/pages/topic-a/page-three.adoc'
          const symlinkDir = 'modules/ROOT/pages/topic-c'
          const pageInsideSymlinkDir = 'modules/ROOT/pages/topic-c/page-three.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, {}, fixturePaths, () =>
            repoBuilder.addToWorktree(symlinkDir, targetDir, 'dir').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const expectedMode =
            repoBuilder.remote || repoBuilder.bare
              ? 0o100666 & ~process.umask()
              : (await fsp.stat(ospath.join(repoBuilder.repoPath, targetPath))).mode
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const page = aggregate[0].files.find((file) => file.path === pageInsideSymlinkDir)
          expect(page).to.exist()
          expect(page.symlink).to.not.exist()
          expect(page.stat.mode).to.equal(expectedMode)
          expect(page.contents).to.deep.equal(expectedContents)
          if (repoBuilder.remote) {
            expect(page.src.origin.worktree).to.be.undefined()
          } else if (repoBuilder.bare) {
            expect(page.src.origin.worktree).to.be.false()
          }
        })
      })

      describe('should resolve files inside directory inside directory symlink', () => {
        testAll(async (repoBuilder) => {
          const targetDir = 'modules/ROOT/pages/topic-b'
          const targetPath = 'modules/ROOT/pages/topic-b/subtopic/page-five.adoc'
          const symlinkDir = 'modules/ROOT/pages/topic-c'
          const pageInsideSymlinkDir = 'modules/ROOT/pages/topic-c/subtopic/page-five.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, {}, fixturePaths, () =>
            repoBuilder.addToWorktree(symlinkDir, targetDir, 'dir').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const expectedMode =
            repoBuilder.remote || repoBuilder.bare
              ? 0o100666 & ~process.umask()
              : (await fsp.stat(ospath.join(repoBuilder.repoPath, targetPath))).mode
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const page = aggregate[0].files.find((file) => file.path === pageInsideSymlinkDir)
          expect(page).to.exist()
          expect(page.symlink).to.not.exist()
          expect(page.stat.mode).to.equal(expectedMode)
          expect(page.contents).to.deep.equal(expectedContents)
          if (repoBuilder.remote) {
            expect(page.src.origin.worktree).to.be.undefined()
          } else if (repoBuilder.bare) {
            expect(page.src.origin.worktree).to.be.false()
          }
        })
      })

      describe('should allow multiple symlinks to share the same file symlink', () => {
        testAll(async (repoBuilder) => {
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder
              .addToWorktree('topic-b/the-page.adoc', '= The Page')
              .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/topic-b', 'topic-b', 'dir'))
              .then(() => repoBuilder.addToWorktree('topic-b/page-c.adoc', 'topic-b/the-page.adoc', true))
              .then(() => repoBuilder.addToWorktree('topic-b/page-a.adoc', 'topic-b/page-c.adoc', true))
              .then(() => repoBuilder.addToWorktree('topic-b/page-b.adoc', 'topic-b/page-c.adoc', true))
              .then(() => repoBuilder.commitAll('add symlinks'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const files = aggregate[0].files
          expect(files).to.have.lengthOf(8)
          files.forEach((file) => expect(file.contents.toString()).to.equal('= The Page'))
        })
      })

      describe('should allow multiple symlinks to share the same dir symlink', () => {
        testAll(async (repoBuilder) => {
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder
              .addToWorktree('dir/subdir/d.adoc', '= The Page')
              .then(() => repoBuilder.addToWorktree('link', 'dir', 'dir'))
              .then(() => repoBuilder.addToWorktree('to-link', 'link', 'dir'))
              .then(() => repoBuilder.addToWorktree('dir/a', 'dir/subdir', 'dir'))
              .then(() => repoBuilder.addToWorktree('dir/b', 'dir/subdir', 'dir'))
              .then(() => repoBuilder.commitAll('add symlinks'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const files = aggregate[0].files
          expect(files).to.have.lengthOf(9)
          files.forEach((file) => expect(file.contents.toString()).to.equal('= The Page'))
        })
      })

      describe('should resolve directory symlink that ends with trailing slash', () => {
        testAll(async (repoBuilder) => {
          const targetDir = 'more-pages'
          const targetPath = 'more-pages/the-page.adoc'
          const symlinkDir = 'modules/ROOT/pages/topic'
          const pageInsideSymlinkDir = 'modules/ROOT/pages/topic/the-page.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, {}, fixturePaths, () =>
            repoBuilder.addToWorktree(symlinkDir, targetDir, 'dir/').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const page = aggregate[0].files.find((file) => file.path === pageInsideSymlinkDir)
          expect(page).to.exist()
          expect(page.symlink).to.not.exist()
          expect(page.contents).to.deep.equal(expectedContents)
        })
      })

      describe('should resolve directory symlink to directory at root that ends with trailing slash', () => {
        testAll(async (repoBuilder) => {
          const targetDir = 'src/main/asciidoc'
          const targetPath = 'src/main/asciidoc/ROOT/pages/the-page.adoc'
          const symlinkDir = 'modules'
          const pageInsideSymlinkDir = 'modules/ROOT/pages/the-page.adoc'
          const fixturePaths = [targetPath]
          await initRepoWithFiles(repoBuilder, {}, fixturePaths, () =>
            repoBuilder.addToWorktree(symlinkDir, targetDir, 'dir/').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
          const page = aggregate[0].files.find((file) => file.path === pageInsideSymlinkDir)
          expect(page).to.exist()
          expect(page.symlink).to.not.exist()
          expect(page.contents).to.deep.equal(expectedContents)
        })
      })

      describe('should report error if symlink to sibling file is broken', () => {
        testAll(async (repoBuilder) => {
          const targetPath = 'modules/ROOT/pages/target.adoc'
          const symlinkPath = 'modules/ROOT/pages/symlink.adoc'
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder.addToWorktree(symlinkPath, targetPath, 'file').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.normalizePath(symlinkPath)
          const expectedLink = expectedFrom + ' -> target.adoc'
          let expectedMessage = `ENOENT: broken symbolic link, ${expectedLink}`
          if (repoBuilder.local) {
            const abspath = ospath.join(repoBuilder.repoPath, symlinkPath)
            const { messages, returnValue: aggregate } = (
              await captureLog(() => aggregateContent(playbookSpec))
            ).withReturnValue()
            expect(aggregate).to.have.lengthOf(1)
            expect(messages).to.have.lengthOf(1)
            expect(messages[0]).to.have.property('level', 'error')
            expect(messages[0]).to.have.property('msg', expectedMessage)
            expect(messages[0]).to.have.nested.property('file.path', abspath)
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
            expect(aggregate[0].files.find((it) => it.src.abspath === abspath)).to.be.undefined()
          } else {
            expectedMessage += ` in ${repoBuilder.url} (branch: ${ref})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      describe('should report error if symlink to file in parent folder is broken', () => {
        testAll(async (repoBuilder) => {
          const targetPath = 'modules/ROOT/pages/target.adoc'
          const symlinkPath = 'modules/ROOT/pages/the-topic/symlink.adoc'
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder.addToWorktree(symlinkPath, targetPath, 'file').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.normalizePath(symlinkPath)
          const expectedTo = repoBuilder.joinPath('..', 'target.adoc')
          const expectedLink = expectedFrom + ' -> ' + expectedTo
          let expectedMessage = `ENOENT: broken symbolic link, ${expectedLink}`
          if (repoBuilder.local) {
            const messages = await captureLog(() => aggregateContent(playbookSpec))
            expect(messages).to.have.lengthOf(1)
            expect(messages[0]).to.have.property('msg', expectedMessage)
            expect(messages[0]).to.have.nested.property('file.path', ospath.join(repoBuilder.repoPath, symlinkPath))
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
          } else {
            expectedMessage += ` in ${repoBuilder.url} (branch: ${ref})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      describe('should report error if symlink resolved from symlink is broken', () => {
        testAll(async (repoBuilder) => {
          const targetPath = 'modules/ROOT/pages/page-one.adoc'
          const symlink1Path = 'modules/ROOT/pages/topic-c/page-one-link.adoc'
          const symlink2Path = 'modules/ROOT/pages/page-one-link.adoc'
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder
              .addToWorktree(symlink1Path, symlink2Path, 'file')
              .then(() => repoBuilder.addToWorktree(symlink2Path, targetPath, 'file'))
              .then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.normalizePath(symlink2Path)
          const expectedLink = expectedFrom + ' -> page-one.adoc'
          let expectedMessage = `ENOENT: broken symbolic link, ${expectedLink}`
          if (repoBuilder.local) {
            const messages = await captureLog(() => aggregateContent(playbookSpec))
            expect(messages).to.have.lengthOf(2)
            expect(messages[0]).to.have.property('msg', expectedMessage)
            expect(messages[0]).to.have.nested.property('file.path', ospath.join(repoBuilder.repoPath, symlink2Path))
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
          } else {
            expectedMessage += ` in ${repoBuilder.url} (branch: ${ref})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      describe('should report error if symlink found in content root at start path is broken', () => {
        testAll(async (repoBuilder) => {
          const startPath = 'docs'
          const componentDesc = { name: 'the-component', version: '1.0', startPath }
          const targetPath = 'modules/ROOT/pages/topic/target.adoc'
          const symlinkPath = 'modules/ROOT/pages/the-symlink.adoc'
          await initRepoWithFiles(repoBuilder, componentDesc, [], () =>
            repoBuilder
              .addToWorktree(startPath + '/' + symlinkPath, startPath + '/' + targetPath, 'file')
              .then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main', startPath })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.normalizePath(symlinkPath)
          const expectedTo = repoBuilder.joinPath('topic', 'target.adoc')
          const expectedLink = `${expectedFrom} -> ${expectedTo}`
          let expectedMessage = `ENOENT: broken symbolic link, ${expectedLink}`
          if (repoBuilder.local) {
            const messages = await captureLog(() => aggregateContent(playbookSpec))
            expect(messages).to.have.lengthOf(1)
            expect(messages[0]).to.have.property('msg', expectedMessage)
            expect(messages[0]).to.have.nested.property(
              'file.path',
              ospath.join(repoBuilder.repoPath, startPath, symlinkPath)
            )
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
            expect(messages[0]).to.have.nested.property('source.startPath', startPath)
          } else {
            expectedMessage += ` in ${repoBuilder.url} (branch: ${ref} | start path: ${startPath})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      describe('should report error if symlink that points outside content root at start path is broken', () => {
        testAll(async (repoBuilder) => {
          const startPath = 'docs'
          const componentDesc = { name: 'the-component', version: '1.0', startPath }
          const symlinkPath = 'modules/ROOT/pages/project/link-to-process.adoc'
          await initRepoWithFiles(repoBuilder, componentDesc, [], () =>
            repoBuilder
              .addToWorktree(startPath + '/modules/ROOT/pages/project', 'project', 'dir')
              .then(() => repoBuilder.addToWorktree('project/link-to-process.adoc', 'project/process.adoc', 'file'))
              .then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main', startPath })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.normalizePath(symlinkPath)
          const expectedLink = `${expectedFrom} -> process.adoc`
          let expectedMessage = `ENOENT: broken symbolic link, ${expectedLink}`
          if (repoBuilder.local) {
            const messages = await captureLog(() => aggregateContent(playbookSpec))
            expect(messages).to.have.lengthOf(1)
            expect(messages[0]).to.have.property('msg', expectedMessage)
            expect(messages[0]).to.have.nested.property(
              'file.path',
              ospath.join(repoBuilder.repoPath, startPath, symlinkPath)
            )
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
            expect(messages[0]).to.have.nested.property('source.startPath', startPath)
          } else {
            expectedMessage += ` in ${repoBuilder.url} (branch: ${ref} | start path: ${startPath})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      describe('should report error if self-referencing file symlink is detected', () => {
        testAll(async (repoBuilder) => {
          const symlinkPath = 'modules/ROOT/pages/symlink.adoc'
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder.addToWorktree(symlinkPath, symlinkPath, 'file').then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.normalizePath(symlinkPath)
          const expectedLink = `${expectedFrom} -> symlink.adoc`
          let expectedMessage = `ELOOP: symbolic link cycle, ${expectedLink}`
          if (repoBuilder.local) {
            const abspath = ospath.join(repoBuilder.repoPath, symlinkPath)
            const { messages, returnValue: aggregate } = (
              await captureLog(() => aggregateContent(playbookSpec))
            ).withReturnValue()
            expect(messages).to.have.lengthOf(1)
            expect(messages[0]).to.have.property('level', 'error')
            expect(messages[0]).to.have.property('msg', expectedMessage)
            expect(messages[0]).to.have.nested.property('file.path', abspath)
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
            expect(aggregate[0].files.find((it) => it.src.abspath === abspath)).to.be.undefined()
          } else {
            expectedMessage += ` in ${repoBuilder.url} (branch: ${ref})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      it('should report error if self-referencing directory symlink is detected', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { bare: true })
        const symlinkPath = 'subdir/to-dot'
        await initRepoWithFiles(repoBuilder, {}, [], () =>
          repoBuilder.addToWorktree(symlinkPath, '.', 'dir').then(() => repoBuilder.commitAll('add symlink'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
        const ref = repoBuilder.getRefInfo('main')
        const expectedFrom = repoBuilder.normalizePath(symlinkPath)
        const expectedLink = `${expectedFrom} -> .`
        const expectedMessage = `ELOOP: symbolic link cycle, ${expectedLink} in ${repoBuilder.url} (branch: ${ref})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })

      // this test is really slow to set up, presumably because of limitations in isomorphic-git
      //it('should report error if parent-referencing directory symlink is detected', async () => {
      //  const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { bare: true })
      //  const symlinkPath = 'subdir/to-dot'
      //  await initRepoWithFiles(repoBuilder, {}, [], () =>
      //    repoBuilder.addToWorktree(symlinkPath, '..', 'dir').then(() => repoBuilder.commitAll('add symlink'))
      //  )
      //  playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
      //  const ref = repoBuilder.getRefInfo('main')
      //  const expectedFrom = repoBuilder.normalizePath(symlinkPath)
      //  const expectedLink = `${expectedFrom} -> ..`
      //  const expectedMessage = `ELOOP: symbolic link cycle, ${expectedLink} in ${repoBuilder.url} (branch: ${ref})`
      //  expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      //})

      describe('should report error if file symlink cycle is detected', () => {
        testAll(async (repoBuilder) => {
          const symlink1Path = 'modules/ROOT/pages/page-one-link.adoc'
          const symlink2Path = 'modules/ROOT/pages/the-topic/page-one-link.adoc'
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder
              .addToWorktree(symlink1Path, symlink2Path, 'file')
              .then(() => repoBuilder.addToWorktree(symlink2Path, symlink1Path, 'file'))
              .then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.normalizePath(symlink1Path)
          const expectedTo = repoBuilder.joinPath('the-topic', 'page-one-link.adoc')
          const expectedLink = `${expectedFrom} -> ${expectedTo}`
          let expectedMessage = `ELOOP: symbolic link cycle, ${expectedLink}`
          if (repoBuilder.local) {
            const messages = await captureLog(() => aggregateContent(playbookSpec))
            expect(messages).to.have.lengthOf(2)
            expect(messages[0]).to.have.property('msg', expectedMessage)
            expect(messages[0]).to.have.nested.property('file.path', ospath.join(repoBuilder.repoPath, symlink1Path))
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
          } else {
            expectedMessage += ` in ${repoBuilder.url} (branch: ${ref})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      describe('should report error if directory symlink cycle is detected', async () => {
        testAll(async (repoBuilder) => {
          const symlink1Path = 'modules/ROOT/pages/foo'
          const symlink2Path = 'modules/ROOT/pages/bar'
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder
              .addToWorktree(symlink1Path, symlink2Path, 'file')
              .then(() => repoBuilder.addToWorktree(symlink2Path, symlink1Path, 'file'))
              .then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.normalizePath(symlink2Path)
          const expectedTo = 'foo'
          const expectedLink = `${expectedFrom} -> ${expectedTo}`
          let expectedMessage = `ELOOP: symbolic link cycle, ${expectedLink}`
          if (repoBuilder.local) {
            const messages = await captureLog(() => aggregateContent(playbookSpec))
            expect(messages).to.have.lengthOf(2)
            expect(messages[0]).to.have.property('msg', expectedMessage)
            expect(messages[0]).to.have.nested.property('file.path', ospath.join(repoBuilder.repoPath, symlink2Path))
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
          } else {
            expectedMessage += ` in ${repoBuilder.url} (branch: ${ref})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      describe('should report error if reentrant directory symlink cycle is detected', async () => {
        testAll(async (repoBuilder) => {
          await initRepoWithFiles(repoBuilder, {}, [], () =>
            repoBuilder
              .addToWorktree('a', 'b', 'dir')
              .then(() => repoBuilder.addToWorktree('b/c.adoc', 'c'))
              .then(() => repoBuilder.addToWorktree('b/d.adoc', 'd'))
              .then(() => repoBuilder.addToWorktree('b/e', 'a', 'dir'))
              .then(() => repoBuilder.commitSelect(['a', 'b', 'b/c.adoc', 'b/d.adoc', 'b/e'], 'add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
          const ref = repoBuilder.getRefInfo('main')
          const expectedFrom = repoBuilder.joinPath('a', 'e')
          const expectedTo = repoBuilder.joinPath('..', 'a')
          const expectedLink = `${expectedFrom} -> ${expectedTo}`
          let expectedMessage = 'ELOOP: symbolic link cycle, '
          if (repoBuilder.local) {
            const messages = await captureLog(() => aggregateContent(playbookSpec))
            expect(messages).to.have.lengthOf(2)
            // NOTE: glob produces a wacky result in this case, so don't try to assert link info
            expect(messages[0].msg).to.startWith(expectedMessage)
            // NOTE: on Windows, link direction is not determinant
            const linkStart = messages[0].msg.substr(expectedMessage.length).split(ospath.sep, 2).join(ospath.sep)
            expect(messages[0].file.path).to.startWith(repoBuilder.joinPath(repoBuilder.repoPath, linkStart))
            expect(messages[0]).to.have.nested.property('source.worktree', repoBuilder.repoPath)
          } else {
            expectedMessage += `${expectedLink} in ${repoBuilder.url} (branch: ${ref})`
            expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
          }
        })
      })

      describe('should resolve symlink that points outside of start path', () => {
        testAll(async (repoBuilder) => {
          const startPath = 'path/to/docs'
          const componentDesc = { name: 'the-component', version: '1.0', startPath }
          const targetPath = 'modules/ROOT/pages/page-one.adoc'
          const symlinkPath = 'modules/ROOT/pages/topic-c/page-one-link.adoc'
          await initRepoWithFiles(repoBuilder, componentDesc, [], () =>
            repoBuilder
              .addFilesFromFixture([targetPath], '', false)
              .then(() => repoBuilder.addToWorktree(ospath.join(startPath, symlinkPath), targetPath, 'file'))
              .then(() => repoBuilder.commitAll('add symlink'))
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main', startPath })
          const expectedMode =
            repoBuilder.remote || repoBuilder.bare
              ? 0o100666 & ~process.umask()
              : (await fsp.stat(ospath.join(repoBuilder.repoPath, targetPath))).mode
          const expectedContents = await fsp.readFile(ospath.join(repoBuilder.repoPath, targetPath))
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(aggregate[0]).to.include({ name: 'the-component', version: '1.0' })
          const symlinkPage = aggregate[0].files.find((file) => file.path === symlinkPath)
          expect(symlinkPage).to.exist()
          expect(symlinkPage.symlink).to.not.exist()
          expect(symlinkPage.stat.mode).to.equal(expectedMode)
          expect(symlinkPage.contents).to.deep.equal(expectedContents)
          if (repoBuilder.remote) {
            expect(symlinkPage.src.origin.worktree).to.be.undefined()
          } else if (repoBuilder.bare) {
            expect(symlinkPage.src.origin.worktree).to.be.false()
          }
        })
      })

      it('should resolve file symlink in worktree that points outside worktree', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const componentDesc = { name: 'the-component', version: '1.0' }
        const targetPath = ospath.join(FIXTURES_DIR, 'modules/ROOT/pages/page-one.adoc')
        const symlinkPath = 'modules/ROOT/pages/topic-c/page-one-link.adoc'
        await initRepoWithFiles(repoBuilder, componentDesc, [], () =>
          repoBuilder.addToWorktree(symlinkPath, targetPath, 'file').then(() => repoBuilder.commitAll('add symlink'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'main' })
        const expectedMode = (await fsp.stat(targetPath)).mode
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: '1.0' })
        const symlinkPage = aggregate[0].files.find((file) => file.path === symlinkPath)
        expect(symlinkPage).to.exist()
        expect(symlinkPage.symlink).to.not.exist()
        expect(symlinkPage.stat.mode).to.equal(expectedMode)
      })
    })

    describe('should skip files and directories and directories that begin with a dot or end with a tilde', () => {
      testAll(async (repoBuilder) => {
        const fixturePaths = [
          // directory with extension
          'modules/ROOT/pages/keep.me/page.adoc',
          // extensionless file
          'modules/ROOT/examples/noext',
          // backup file
          'modules/ROOT/pages/index.adoc~',
          // dotfile
          'modules/ROOT/pages/.ignore-me',
          // dotfile with extension
          'modules/ROOT/pages/.ignore-me.txt',
          // dotdir
          'modules/ROOT/pages/.ignore-it/page.adoc',
          // dotdir with extension
          'modules/ROOT/pages/.ignore.rc/page.adoc',
          // dotfile at root
          '.ignore-me',
          // dotfile with extension at root
          '.ignore-me.txt',
          // dotdir at root
          '.ignore-it/run.sh',
          // dotdir with extension at root
          '.ignore.rc/run.sh',
        ]
        const ignoredPaths = fixturePaths.filter(
          (path_) => !(path_ === 'modules/ROOT/pages/keep.me/page.adoc' || path_ === 'modules/ROOT/examples/noext')
        )
        await initRepoWithFiles(repoBuilder, {}, undefined, () => repoBuilder.addFilesFromFixture(fixturePaths))
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const files = aggregate[0].files
        const paths = files.map((f) => f.path)
        ignoredPaths.forEach((ignoredPath) => expect(paths).to.not.include(ignoredPath))
        // make sure there is no entry for directory with file extension
        files.forEach((file) => expect(file.isDirectory()).to.be.false())
      })
    })

    describe('should aggregate all files when component is located at a start path', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: 'v1.2.3', startPath: 'docs' }
        const fixturePaths = [
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
        ]
        await initRepoWithFiles(repoBuilder, componentDesc, fixturePaths, () =>
          repoBuilder.addFilesFromFixture('should-be-ignored.adoc', '', false)
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: repoBuilder.startPath })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include(componentDesc)
        const files = componentVersion.files
        expect(files).to.have.lengthOf(fixturePaths.length)
        const paths = files.map((file) => file.path)
        const relatives = files.map((file) => file.relative)
        expect(paths).to.have.members(fixturePaths)
        expect(relatives).to.have.members(fixturePaths)
        files.forEach((file) => expect(file).to.have.nested.property('src.origin.startPath', 'docs'))
      })
    })

    describe('should aggregate all files when component is located at a nested start path', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: 'v1.2.3', startPath: 'src/docs' }
        const fixturePaths = [
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
        ]
        await initRepoWithFiles(repoBuilder, componentDesc, fixturePaths, () =>
          repoBuilder.addFilesFromFixture('should-be-ignored.adoc', '', false)
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: repoBuilder.startPath })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include(componentDesc)
        const files = componentVersion.files
        expect(files).to.have.lengthOf(fixturePaths.length)
        const paths = files.map((file) => file.path)
        const relatives = files.map((file) => file.relative)
        expect(paths).to.have.members(fixturePaths)
        expect(relatives).to.have.members(fixturePaths)
        files.forEach((file) => expect(file).to.have.nested.property('src.origin.startPath', 'src/docs'))
      })
    })

    describe('should trim leading and trailing slashes from start path', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: 'v1.2.3', startPath: '/src/docs/' }
        const fixturePaths = ['modules/ROOT/pages/page-one.adoc']
        await initRepoWithFiles(repoBuilder, componentDesc, fixturePaths)
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: repoBuilder.startPath })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include(componentDesc)
        const files = componentVersion.files
        expect(files).to.have.lengthOf(fixturePaths.length)
        files.forEach((file) => expect(file).to.have.nested.property('src.origin.startPath', 'src/docs'))
      })
    })

    describe('should assign correct properties to virtual files taken from root of repository', () => {
      testAll(async (repoBuilder) => {
        let refhash
        await initRepoWithFiles(repoBuilder, undefined, undefined, () =>
          repoBuilder.resolveRef().then((oid) => (refhash = oid))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        const pageOne = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        const expectedFile = {
          path: 'modules/ROOT/pages/page-one.adoc',
          relative: 'modules/ROOT/pages/page-one.adoc',
          dirname: 'modules/ROOT/pages',
          basename: 'page-one.adoc',
          stem: 'page-one',
          extname: '.adoc',
        }
        const expectedFileSrc = {
          path: expectedFile.path,
          basename: expectedFile.basename,
          stem: expectedFile.stem,
          extname: expectedFile.extname,
          origin: {
            type: 'git',
            reftype: 'branch',
            refname: 'main',
            branch: 'main',
            startPath: '',
            descriptor: {
              name: 'the-component',
              title: 'The Component',
              version: 'v1.2.3',
            },
          },
        }
        if (repoBuilder.remote) {
          expectedFileSrc.origin.gitdir = ospath.join(CONTENT_CACHE_DIR, generateCloneFolderName(repoBuilder.url))
          expectedFileSrc.origin.webUrl = (expectedFileSrc.origin.url = repoBuilder.url).replace(/\.git$/, '')
          expectedFileSrc.origin.refhash = refhash
        } else if (repoBuilder.bare) {
          expectedFileSrc.origin.gitdir = repoBuilder.url
          expectedFileSrc.origin.url = pathToFileURL(repoBuilder.url)
          expectedFileSrc.origin.refhash = refhash
          expectedFileSrc.origin.worktree = false
        } else {
          expectedFileSrc.abspath = ospath.join(repoBuilder.repoPath, expectedFileSrc.path)
          expectedFileSrc.origin.url = pathToFileURL(repoBuilder.url)
          expectedFileSrc.origin.fileUriPattern = expectedFileSrc.origin.url + '/%s'
          expectedFileSrc.origin.gitdir = ospath.join((expectedFileSrc.origin.worktree = repoBuilder.repoPath), '.git')
          expectedFileSrc.fileUri = pathToFileURL(expectedFileSrc.abspath)
        }
        expect(pageOne).to.include(expectedFile)
        expect(pageOne.src).to.eql(expectedFileSrc)
      })
    })

    describe('should assign correct properties to virtual files taken from start path', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: 'v1.2.3', startPath: 'docs' }
        let refhash
        await initRepoWithFiles(repoBuilder, componentDesc, undefined, () =>
          repoBuilder.resolveRef().then((oid) => (refhash = oid))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: repoBuilder.startPath })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        const pageOne = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        const expectedFile = {
          path: 'modules/ROOT/pages/page-one.adoc',
          relative: 'modules/ROOT/pages/page-one.adoc',
          dirname: 'modules/ROOT/pages',
          basename: 'page-one.adoc',
          stem: 'page-one',
          extname: '.adoc',
        }
        const expectedFileSrc = {
          path: expectedFile.path,
          basename: expectedFile.basename,
          stem: expectedFile.stem,
          extname: expectedFile.extname,
          origin: {
            type: 'git',
            reftype: 'branch',
            refname: 'main',
            branch: 'main',
            startPath: 'docs',
            descriptor: {
              name: 'the-component',
              title: 'The Component',
              version: 'v1.2.3',
            },
          },
        }
        if (repoBuilder.remote) {
          expectedFileSrc.origin.gitdir = ospath.join(CONTENT_CACHE_DIR, generateCloneFolderName(repoBuilder.url))
          expectedFileSrc.origin.webUrl = (expectedFileSrc.origin.url = repoBuilder.url).replace(/\.git$/, '')
          expectedFileSrc.origin.refhash = refhash
        } else if (repoBuilder.bare) {
          expectedFileSrc.origin.gitdir = repoBuilder.url
          expectedFileSrc.origin.url = pathToFileURL(repoBuilder.url)
          expectedFileSrc.origin.refhash = refhash
          expectedFileSrc.origin.worktree = false
        } else {
          expectedFileSrc.abspath = ospath.join(repoBuilder.repoPath, repoBuilder.startPath, expectedFileSrc.path)
          expectedFileSrc.origin.url = pathToFileURL(repoBuilder.url)
          expectedFileSrc.origin.fileUriPattern =
            pathToFileURL(ospath.join(repoBuilder.repoPath, repoBuilder.startPath)) + '/%s'
          expectedFileSrc.origin.gitdir = ospath.join((expectedFileSrc.origin.worktree = repoBuilder.repoPath), '.git')
          expectedFileSrc.fileUri = pathToFileURL(expectedFileSrc.abspath)
        }
        expect(pageOne).to.include(expectedFile)
        expect(pageOne.src).to.eql(expectedFileSrc)
      })
    })

    describe('should encode spaces in editUrl and fileUri', () => {
      testAll(async (repoBuilder) => {
        let refhash
        await initRepoWithFiles(repoBuilder, undefined, 'modules/ROOT/pages/page with spaces.adoc', () =>
          repoBuilder.resolveRef().then((oid) => (refhash = oid))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        const actualFile = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page with spaces.adoc')
        const expectedFile = {
          path: 'modules/ROOT/pages/page with spaces.adoc',
          relative: 'modules/ROOT/pages/page with spaces.adoc',
          dirname: 'modules/ROOT/pages',
          basename: 'page with spaces.adoc',
          stem: 'page with spaces',
          extname: '.adoc',
        }
        const expectedFileSrc = {
          path: expectedFile.path,
          basename: expectedFile.basename,
          stem: expectedFile.stem,
          extname: expectedFile.extname,
          origin: {
            type: 'git',
            reftype: 'branch',
            refname: 'main',
            branch: 'main',
            startPath: '',
            descriptor: {
              name: 'the-component',
              title: 'The Component',
              version: 'v1.2.3',
            },
          },
        }
        if (repoBuilder.remote) {
          expectedFileSrc.origin.gitdir = ospath.join(CONTENT_CACHE_DIR, generateCloneFolderName(repoBuilder.url))
          expectedFileSrc.origin.webUrl = (expectedFileSrc.origin.url = repoBuilder.url).replace(/\.git$/, '')
          expectedFileSrc.origin.refhash = refhash
        } else if (repoBuilder.bare) {
          expectedFileSrc.origin.gitdir = repoBuilder.url
          expectedFileSrc.origin.url = pathToFileURL(repoBuilder.url)
          expectedFileSrc.origin.refhash = refhash
          expectedFileSrc.origin.worktree = false
        } else {
          expectedFileSrc.abspath = ospath.join(repoBuilder.repoPath, expectedFileSrc.path)
          expectedFileSrc.origin.url = pathToFileURL(repoBuilder.url)
          expectedFileSrc.origin.fileUriPattern = expectedFileSrc.origin.url + '/%s'
          expectedFileSrc.origin.gitdir = ospath.join((expectedFileSrc.origin.worktree = repoBuilder.repoPath), '.git')
          expectedFileSrc.fileUri = pathToFileURL(expectedFileSrc.abspath)
        }
        expect(actualFile).to.include(expectedFile)
        expect(actualFile.src).to.eql(expectedFileSrc)
      })
    })

    describe('remote origin data', () => {
      it('should resolve origin url from git config for local repository', async () => {
        const remoteUrl = 'https://gitlab.com/antora/demo/demo-component-a'
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const fixturePath = 'modules/ROOT/pages/page-one.adoc'
        await initRepoWithFiles(repoBuilder, {}, fixturePath, () => repoBuilder.config('remote.origin.url', remoteUrl))
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const page = aggregate[0].files[0]
        expect(page).to.not.be.undefined()
        expect(page.src.origin.url).to.equal(remoteUrl)
      })

      it('should remove auth from origin URL resolved from remote URL', async () => {
        const remoteUrl = 'https://user@gitlab.com:p@ssw0rd@gitlab.com/antora/demo/demo-component-a'
        const remoteUrlWithoutAuth = 'https://gitlab.com/antora/demo/demo-component-a'
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const fixturePath = 'modules/ROOT/pages/page-one.adoc'
        await initRepoWithFiles(repoBuilder, {}, fixturePath, () => repoBuilder.config('remote.origin.url', remoteUrl))
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const page = aggregate[0].files[0]
        expect(page).to.not.be.undefined()
        expect(page.src.origin.url).to.equal(remoteUrlWithoutAuth)
      })

      it('should not remove .git extension from url resolved from git config for local repository', async () => {
        const remoteUrl = 'https://gitlab.com/antora/demo/demo-component-a.git'
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const fixturePath = 'modules/ROOT/pages/page-one.adoc'
        await initRepoWithFiles(repoBuilder, {}, fixturePath, () => repoBuilder.config('remote.origin.url', remoteUrl))
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const page = aggregate[0].files[0]
        expect(page).to.not.be.undefined()
        expect(page.src.origin.url).to.equal(remoteUrl)
      })

      it('should coerce implicit SSH URI resolved from git config for local repository to HTTPS URL', async () => {
        const remoteUrl = 'git@gitlab.com:antora/demo/demo-component-a.git'
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const fixturePath = 'modules/ROOT/pages/page-one.adoc'
        await initRepoWithFiles(repoBuilder, {}, fixturePath, () => repoBuilder.config('remote.origin.url', remoteUrl))
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const page = aggregate[0].files[0]
        expect(page).to.not.be.undefined()
        expect(page.src.origin.url).to.equal('https://gitlab.com/antora/demo/demo-component-a.git')
      })

      it('should coerce SSH URI resolved from git config for local repository to HTTPS URL', async () => {
        const remoteUrls = [
          'ssh://git@gitlab.com/antora/demo/demo-component-a.git',
          'ssh://git@gitlab.com:8022/antora/demo/demo-component-a.git',
          'ssh://gitlab.com/antora/demo/demo-component-a.git',
          'ssh://gitlab.com:8022/antora/demo/demo-component-a.git',
        ]
        for (const [idx, remoteUrl] of remoteUrls.entries()) {
          const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
          const fixturePath = 'modules/ROOT/pages/page-one.adoc'
          await initRepoWithFiles(repoBuilder, { repoName: `the-component-${idx}` }, fixturePath, () =>
            repoBuilder.config('remote.origin.url', remoteUrl)
          )
          playbookSpec.content.sources.push({ url: repoBuilder.url })
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          const page = aggregate[0].files[0]
          expect(page).to.not.be.undefined()
          expect(page.src.origin.url).to.equal('https://gitlab.com/antora/demo/demo-component-a.git')
        }
      })

      it('should clean credentials from remote url retrieved from git config', async () => {
        const remoteUrl = 'https://u:p@gitlab.com/antora/demo/demo-component-a.git'
        const remoteUrlWithoutAuth = remoteUrl.replace('u:p@', '')
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const fixturePath = 'modules/ROOT/pages/page-one.adoc'
        await initRepoWithFiles(repoBuilder, {}, fixturePath, () => repoBuilder.config('remote.origin.url', remoteUrl))
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const page = aggregate[0].files[0]
        expect(page).to.not.be.undefined()
        expect(page.src.origin.url).to.equal(remoteUrlWithoutAuth)
      })

      it('should set origin url for local repository if remote url in git config is not recognized', async () => {
        const remoteUrl = 'git://git-host/repo.git'
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const fixturePath = 'modules/ROOT/pages/page-one.adoc'
        await initRepoWithFiles(repoBuilder, {}, fixturePath, () => repoBuilder.config('remote.origin.url', remoteUrl))
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const page = aggregate[0].files[0]
        expect(page).to.not.be.undefined()
        const expectedOriginUrl = pathToFileURL(repoBuilder.url)
        expect(page.src.origin.url).to.equal(expectedOriginUrl)
        expect(page.src.origin.worktree).to.exist()
      })

      it('should set origin url for local repository if not using worktree and remote url is not set in git config', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const repoName = 'the-component-no-remote'
        await initRepoWithFiles(repoBuilder, { repoName }, 'modules/ROOT/pages/page-one.adoc')
        playbookSpec.content.sources.push({ url: repoBuilder.url, worktrees: false })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const page = aggregate[0].files[0]
        expect(page).to.not.be.undefined()
        const expectedOriginUrl = pathToFileURL(repoBuilder.url)
        expect(page.src.origin.url).to.equal(expectedOriginUrl)
        expect(page.src.origin.worktree).to.be.false()
      })

      it('should set origin url for local repository if using worktree and remote url is not set in git config', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const repoName = 'the-component-no-remote'
        await initRepoWithFiles(repoBuilder, { repoName }, 'modules/ROOT/pages/page-one.adoc')
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const page = aggregate[0].files[0]
        expect(page).to.not.be.undefined()
        const expectedOriginUrl = pathToFileURL(repoBuilder.url)
        expect(page.src.origin.url).to.equal(expectedOriginUrl)
        expect(page.src.origin.worktree).to.exist()
      })

      it('should generate correct origin data for file taken from repository on GitHub', () => {
        const urls = [
          'https://{hostname}/org-name/repo-name.git',
          'https://{hostname}/org-name/repo-name',
          'git@{hostname}:org-name/repo-name.git',
          'git@{hostname}:org-name/repo-name',
        ]
        const hostnames = ['github.com', 'private.github.com']
        const action = { branch: 'edit', tag: 'blob' }
        const refs = [['main', 'branch'], ['v1.1.0', 'tag']] // prettier-ignore
        refs.forEach(([shortname, type]) => {
          hostnames.forEach((hostname) => {
            urls.forEach((url) => {
              url = url.replace('{hostname}', hostname)
              const gitdir = ospath.join(CACHE_DIR, 'content', 'org-name-repo-name.git')
              const origin = computeOrigin(url, false, gitdir, { shortname, type, remote: 'origin' }, '')
              expect(origin.gitdir).to.equal(gitdir)
              expect(origin.url).to.equal(url)
              expect(origin.reftype).to.equal(type)
              expect(origin[type]).to.equal(shortname)
              if (hostname === 'github.com') {
                const expectedEditUrlPattern = `https://${hostname}/org-name/repo-name/${action[type]}/${shortname}/%s`
                expect(origin.editUrlPattern).to.equal(expectedEditUrlPattern)
              } else {
                expect(origin).to.not.have.property('editUrlPattern')
              }
            })
          })
        })
      })

      it('should generate correct origin data for file taken from repository on GitLab', () => {
        const urls = [
          'https://{hostname}/org-name/repo-name.git',
          'https://{hostname}/org-name/repo-name',
          'git@{hostname}:org-name/repo-name.git',
          'git@{hostname}:org-name/repo-name',
        ]
        const hostnames = ['gitlab.com', 'private.gitlab.com']
        const action = { branch: 'edit', tag: 'blob' }
        const refs = [['main', 'branch'], ['v1.1.0', 'tag']] // prettier-ignore
        refs.forEach(([shortname, type]) => {
          hostnames.forEach((hostname) => {
            urls.forEach((url) => {
              url = url.replace('{hostname}', hostname)
              const gitdir = ospath.join(CACHE_DIR, 'content', 'org-name-repo-name.git')
              const origin = computeOrigin(url, false, gitdir, { shortname, type, remote: 'origin' }, '')
              expect(origin.gitdir).to.equal(gitdir)
              expect(origin.url).to.equal(url)
              expect(origin.reftype).to.equal(type)
              expect(origin[type]).to.equal(shortname)
              if (hostname === 'gitlab.com') {
                const expectedEditUrlPattern = `https://${hostname}/org-name/repo-name/${action[type]}/${shortname}/%s`
                expect(origin.editUrlPattern).to.equal(expectedEditUrlPattern)
              } else {
                expect(origin).to.not.have.property('editUrlPattern')
              }
            })
          })
        })
      })

      it('should generate correct origin data for file taken from repository on BitBucket', () => {
        const urls = [
          'https://{hostname}/org-name/repo-name.git',
          'https://{hostname}/org-name/repo-name',
          'git@{hostname}:org-name/repo-name.git',
          'git@{hostname}:org-name/repo-name',
        ]
        const hostnames = ['bitbucket.org', 'private.bitbucket.org']
        const refs = [['main', 'branch'], ['v1.1.0', 'tag']] // prettier-ignore
        refs.forEach(([shortname, type]) => {
          hostnames.forEach((hostname) => {
            urls.forEach((url) => {
              url = url.replace('{hostname}', hostname)
              const gitdir = ospath.join(CACHE_DIR, 'content', 'org-name-repo-name.git')
              const origin = computeOrigin(url, false, gitdir, { shortname, type, remote: 'origin' }, '')
              expect(origin.gitdir).to.equal(gitdir)
              expect(origin.url).to.equal(url)
              expect(origin.reftype).to.equal(type)
              expect(origin[type]).to.equal(shortname)
              if (hostname === 'bitbucket.org') {
                const expectedEditUrlPattern = `https://${hostname}/org-name/repo-name/src/${shortname}/%s`
                expect(origin.editUrlPattern).to.equal(expectedEditUrlPattern)
              } else {
                expect(origin).to.not.have.property('editUrlPattern')
              }
            })
          })
        })
      })

      it('should generate correct origin data for file taken from repository on pagure.io', () => {
        const urls = [
          'https://{hostname}/group-name/repo-name.git',
          'https://{hostname}/group-name/repo-name',
          'git@{hostname}:group-name/repo-name.git',
          'git@{hostname}:group-name/repo-name',
        ]
        const hostnames = ['pagure.io', 'private.pagure.io']
        const refs = [['main', 'branch'], ['v1.1.0', 'tag']] // prettier-ignore
        refs.forEach(([shortname, type]) => {
          hostnames.forEach((hostname) => {
            urls.forEach((url) => {
              url = url.replace('{hostname}', hostname)
              const gitdir = ospath.join(CACHE_DIR, 'content', 'org-name-repo-name.git')
              const origin = computeOrigin(url, false, gitdir, { shortname, type, remote: 'origin' }, '')
              expect(origin.gitdir).to.equal(gitdir)
              expect(origin.url).to.equal(url)
              expect(origin.reftype).to.equal(type)
              expect(origin[type]).to.equal(shortname)
              if (hostname === 'pagure.io') {
                const expectedEditUrlPattern = `https://${hostname}/group-name/repo-name/blob/${shortname}/f/%s`
                expect(origin.editUrlPattern).to.equal(expectedEditUrlPattern)
              } else {
                expect(origin).to.not.have.property('editUrlPattern')
              }
            })
          })
        })
      })

      it('should generate correct origin data for file taken from worktree with remote', () => {
        const url = 'https://git.example.org/the-component.git'
        const worktreePath = ospath.join(CONTENT_REPOS_DIR, 'the-component')
        const gitdir = ospath.join(worktreePath, '.git')
        const branch = 'main'
        const expectedfileUriPattern = pathToFileURL(worktreePath) + '/%s'
        const origin = computeOrigin(url, false, gitdir, { shortname: branch, type: 'branch' }, '', worktreePath)
        expect(origin.gitdir).to.equal(gitdir)
        expect(origin.url).to.equal(url)
        expect(origin.reftype).to.equal('branch')
        expect(origin.branch).to.equal(branch)
        expect(origin.refname).to.equal(branch)
        expect(origin).to.not.have.property('remote')
        expect(origin.fileUriPattern).to.equal(expectedfileUriPattern)
        expect(origin.editUrlPattern).to.be.undefined()
        expect(origin.worktree).to.equal(worktreePath)
      })

      it('should generate correct origin data for file taken from worktree with no remote', () => {
        const worktreePath = ospath.join(CONTENT_REPOS_DIR, 'the-component')
        const gitdir = ospath.join(worktreePath, '.git')
        const branch = 'main'
        const url = pathToFileURL(worktreePath)
        const expectedfileUriPattern = pathToFileURL(worktreePath) + '/%s'
        const origin = computeOrigin(url, false, gitdir, { shortname: branch, type: 'branch' }, '', worktreePath)
        expect(origin.gitdir).to.equal(gitdir)
        expect(origin.url).to.equal(url)
        expect(origin.reftype).to.equal('branch')
        expect(origin.branch).to.equal(branch)
        expect(origin.refname).to.equal(branch)
        expect(origin).to.not.have.property('remote')
        expect(origin.fileUriPattern).to.equal(expectedfileUriPattern)
        expect(origin.editUrlPattern).to.be.undefined()
        expect(origin.worktree).to.equal(worktreePath)
      })

      it('should generate correct origin data for file taken from remote branch of local repository', () => {
        const worktreePath = ospath.join(CONTENT_REPOS_DIR, 'the-component')
        const gitdir = ospath.join(worktreePath, '.git')
        const branch = 'v1.0.x'
        const remote = 'origin'
        const url = 'https://github.com/org-name/repo-name.git'
        const origin = computeOrigin(url, false, gitdir, { shortname: branch, type: 'branch', remote }, '', false)
        expect(origin.gitdir).to.equal(gitdir)
        expect(origin.url).to.equal(url)
        expect(origin.reftype).to.equal('branch')
        expect(origin.branch).to.equal(branch)
        expect(origin.refname).to.equal(branch)
        expect(origin.remote).to.equal(remote)
        expect(origin.worktree).to.be.false()
      })

      it('should set refhash property on origin to oid of ref', () => {
        const url = 'https://gitlab.com/antora/demo/demo-component-a.git'
        const gitdir = ospath.join(CONTENT_CACHE_DIR, generateCloneFolderName(url))
        const oid = 'abc123xyz'
        const origin = computeOrigin(url, false, gitdir, { shortname: 'main', type: 'branch', oid }, '', false)
        expect(origin.refhash).to.equal(oid)
      })

      it('should set correct origin data if URL requires auth', () => {
        const url = 'https://gitlab.com/antora/demo/demo-component-a.git'
        const gitdir = ospath.join(CONTENT_CACHE_DIR, generateCloneFolderName(url))
        const origin = computeOrigin(url, 'auth-required', gitdir, { shortname: 'main', type: 'branch' }, '')
        expect(origin.private).to.equal('auth-required')
      })

      it('should not populate editUrl if edit_url key on content source is falsy', async () => {
        const url = 'https://gitlab.com/antora/demo/demo-component-a.git'
        playbookSpec.content.branches = ['v*', 'main']
        playbookSpec.content.sources.push({ url, editUrl: false })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const file = aggregate[0].files[0]
        expect(file.src).to.not.have.property('editUrl')
      })

      it('should use editUrl pattern to generate editUrl', async () => {
        const webUrl = 'https://gitlab.com/antora/demo/demo-component-b'
        const url = webUrl + '.git'
        const sourcePre = { url, branches: 'main', startPath: 'docs', editUrl: '{web_url}/blob/{refhash}/{path}' }
        const sourceTwo = { url, branches: 'v2.0', startPath: 'docs', editUrl: '{web_url}/blob/{refname}/{path}' }
        playbookSpec.content.sources.push(sourcePre)
        playbookSpec.content.sources.push(sourceTwo)
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        const aggregatePre = aggregate.find(({ version }) => version === '2.5')
        const aggregateTwo = aggregate.find(({ version }) => version === '2.0')
        const filePre = aggregatePre.files.find((it) => it.path.startsWith('modules/ROOT/pages/'))
        const fileTwo = aggregateTwo.files.find((it) => it.path.startsWith('modules/ROOT/pages/'))
        expect(filePre.src.editUrl).to.equal(
          `${webUrl}/blob/${filePre.src.origin.refhash}/${filePre.src.origin.startPath}/${filePre.src.path}`
        )
        expect(fileTwo.src.editUrl).to.equal(
          `${webUrl}/blob/${fileTwo.src.origin.branch}/${fileTwo.src.origin.startPath}/${fileTwo.src.path}`
        )
      })
    })

    it('should retry clone operations in serial if fetch concurrency is > 1 and unknown error occurs', async () => {
      const fetches = []
      let reject = true
      const trapFetch = (fetch) => {
        fetches.push(`http://${fetch.req.headers.host}/${fetch.repo}`)
        reject ? (reject = false) || fetch.reject(408) : fetch.accept()
      }
      try {
        gitServer.on('fetch', trapFetch)
        const repoBuilderA = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        const componentDescA = { name: 'component-a', version: '1.0' }
        const repoBuilderB = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        const componentDescB = { name: 'component-b', version: '1.0' }
        await initRepoWithFiles(repoBuilderA, componentDescA, 'modules/ROOT/pages/page-one.adoc')
        await initRepoWithFiles(repoBuilderB, componentDescB, 'modules/ROOT/pages/page-one.adoc')
        playbookSpec.content.sources.push({ url: repoBuilderA.url, branches: 'HEAD' })
        playbookSpec.content.sources.push({ url: repoBuilderB.url, branches: 'HEAD' })
        playbookSpec.git = { fetchConcurrency: 2 }

        const expectedMessage = [
          'An unexpected error occurred while fetching content sources concurrently.',
          'Retrying with git.fetch_concurrency value of 1.',
        ].join(' ')
        const { messages, returnValue: aggregate } = (
          await captureLog(() => aggregateContent(playbookSpec))
        ).withReturnValue()

        expect(aggregate).to.have.lengthOf(2)
        expect(messages).to.have.lengthOf(1)
        expect(messages[0]).to.include({
          level: 'warn',
          msg: expectedMessage,
        })
        expect(messages[0]).to.have.property('err')
        expect(messages[0].err.type).to.equal('Error')
        expect(messages[0].err.message).to.startWith('HTTP Error: 408 Request Timeout')
        expect(messages[0].err.stack).to.include('Caused by: HttpError: HTTP Error: 408 Request Timeout')
        expect(fetches).to.have.lengthOf(3)
        expect(fetches).to.include(repoBuilderA.url)
        expect(fetches).to.include(repoBuilderB.url)
      } finally {
        gitServer.off('fetch', trapFetch)
      }
    })

    it('should not retry clone operations in serial if fetch concurrency is > 1 and only one content source url', async () => {
      const fetches = []
      const trapFetch = (fetch) => {
        fetches.push(`http://${fetch.req.headers.host}/${fetch.repo}`)
        fetch.reject()
      }
      try {
        gitServer.on('fetch', trapFetch)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder, undefined, 'modules/ROOT/pages/page-one.adoc')
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD' })
        playbookSpec.git = { fetchConcurrency: 2 }

        let messages
        const result = await trapAsyncError((deferredError) =>
          captureLog(() => aggregateContent(playbookSpec).catch((e) => (deferredError = e))).then((messages_) => {
            messages = messages_
            if (deferredError) throw deferredError
          })
        )
        expect(result)
          .to.throw(`HTTP Error: 500 Internal Server Error (url: ${repoBuilder.url})`)
          .with.property('recoverable', true)
        expect(messages).to.be.empty()
        expect(fetches).to.have.lengthOf(1)
        expect(fetches[0]).to.equal(repoBuilder.url)
      } finally {
        gitServer.off('fetch', trapFetch)
      }
    })
  })

  describe('distributed component', () => {
    describe('should aggregate files with same component version found in different refs', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: 'v1.2.3' }
        await repoBuilder
          .init(componentDesc.name)
          .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-one.adoc'))
          .then(() => repoBuilder.createTag('v1.2.3'))
          .then(() => repoBuilder.checkoutBranch('v1.2.3-fixes'))
          .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
          .then(() => repoBuilder.removeFromWorktree('modules/ROOT/pages/page-one.adoc'))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-two.adoc'))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v1.2.3-fixes', tags: 'v1.2.3' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include(componentDesc)
        const pageOne = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(pageOne.src.origin.tag).to.equal('v1.2.3')
        expect(pageOne.src.origin.refname).to.equal('v1.2.3')
        const pageTwo = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-two.adoc')
        expect(pageTwo.src.origin.branch).to.equal('v1.2.3-fixes')
        expect(pageTwo.src.origin.refname).to.equal('v1.2.3-fixes')
      })
    })

    describe('should aggregate files with same component version found in different repos', () => {
      testAll(async (repoBuilderA, repoBuilderB) => {
        await initRepoWithFiles(repoBuilderA, { repoName: 'the-component-repo-a' }, 'modules/ROOT/pages/page-one.adoc')
        playbookSpec.content.sources.push({ url: repoBuilderA.url })
        await initRepoWithFiles(repoBuilderB, { repoName: 'the-component-repo-b' }, 'modules/ROOT/pages/page-two.adoc')
        playbookSpec.content.sources.push({ url: repoBuilderB.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        const pageOne = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        const pageTwo = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-two.adoc')
        expect(pageOne).to.exist()
        expect(pageTwo).to.exist()
        // FIXME we can't distinguish origin for local bare repo
        if (repoBuilderA.remote) {
          expect(pageOne.src.origin.url).to.equal(repoBuilderA.url)
          expect(pageTwo.src.origin.url).to.equal(repoBuilderB.url)
        } else if (!repoBuilderA.bare) {
          const expectedPageOneFileUri = pathToFileURL(repoBuilderA.repoPath) + '/' + pageOne.src.path
          const expectedPageTwoFileUri = pathToFileURL(repoBuilderB.repoPath) + '/' + pageTwo.src.path
          expect(pageOne.src.fileUri).to.equal(expectedPageOneFileUri)
          expect(pageTwo.src.fileUri).to.equal(expectedPageTwoFileUri)
        }
      }, 2)
    })

    describe('should add all origins to origins property on component version bucket', () => {
      testAll(async (repoBuilder) => {
        const componentDesc = { name: 'the-component', version: 'v1.2.3' }
        const extraComponentDesc = { ...componentDesc, asciidoc: { attributes: { foo: 'bar' } } }
        await repoBuilder
          .init(componentDesc.name)
          .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-one.adoc'))
          .then(() => repoBuilder.createTag('v1.2.3'))
          .then(() => repoBuilder.checkoutBranch('v1.2.3-extra'))
          .then(() => repoBuilder.addComponentDescriptorToWorktree(extraComponentDesc))
          .then(() => repoBuilder.removeFromWorktree('modules/ROOT/pages/page-one.adoc'))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-two.adoc'))
          .then(() => repoBuilder.close('main'))
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v1.2.3-extra', tags: 'v1.2.3' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include(componentDesc)
        expect(aggregate[0].files).to.have.lengthOf(2)
        expect(aggregate[0]).to.have.property('origins')
        expect(aggregate[0]).not.to.have.property('origin')
        const origins = aggregate[0].origins
        expect(origins).to.have.lengthOf(2)
        origins.sort((a, b) => a.refname.localeCompare(b.refname))
        expect(origins[0].refname).to.equal('v1.2.3')
        expect(origins[1].refname).to.equal('v1.2.3-extra')
        expect(aggregate[0]).not.to.equal(aggregate[0].origins[0].descriptor)
        expect(aggregate[0]).not.to.equal(aggregate[0].origins[1].descriptor)
        expect(aggregate[0].origins[0].descriptor).not.to.equal(aggregate[0].origins[1].descriptor)
        expect(aggregate[0].origins[0].descriptor).not.to.have.property('asciidoc')
        expect(aggregate[0].origins[1].descriptor).to.have.property('asciidoc')
        expect(aggregate[0].origins[1].descriptor.asciidoc).to.eql({ attributes: { foo: 'bar' } })
      })
    })

    describe('should load all repositories when number of repositories exceeds fetch concurrency', () => {
      testAll(async (repoBuilderA, repoBuilderB, repoBuilderC) => {
        const componentDescA = { name: 'the-component-a', version: 'v1.0' }
        await initRepoWithFiles(repoBuilderA, componentDescA, ['modules/ROOT/pages/page-one.adoc'])
        playbookSpec.content.sources.push({ url: repoBuilderA.url })
        const componentDescB = { name: 'the-component-b', version: 'v3.0' }
        await initRepoWithFiles(repoBuilderB, componentDescB, ['modules/ROOT/pages/page-one.adoc'])
        playbookSpec.content.sources.push({ url: repoBuilderB.url })
        const componentDescC = { name: 'the-component-c', version: null }
        await initRepoWithFiles(repoBuilderC, componentDescC, ['modules/ROOT/pages/page-one.adoc'])
        playbookSpec.content.sources.push({ url: repoBuilderC.url })
        playbookSpec.git = { fetchConcurrency: 2, readConcurrency: 2 }
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(3)
        expect(aggregate.map(({ name }) => name)).to.eql(['the-component-a', 'the-component-b', 'the-component-c'])
      }, 3)
    })

    describe('should reuse repository if url occurs multiple times in content sources', () => {
      testAll(async (repoBuilder) => {
        await initRepoWithFiles(repoBuilder, { name: 'the-component', version: 'main' }, [], () =>
          repoBuilder
            .checkoutBranch('v1.0')
            .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: '1.0' }))
            .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-one.adoc'))
            .then(() => repoBuilder.checkoutBranch('v2.0'))
            .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: '2.0' }))
            .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-two.adoc'))
            .then(() => repoBuilder.checkoutBranch('main'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v1.0' })
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v2.0' })
        const aggregate = await aggregateContent(playbookSpec)
        if (repoBuilder.remote) {
          expect(CONTENT_CACHE_DIR).to.be.a.directory().and.subDirs.have.lengthOf(1)
        }
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        expect(aggregate[0]).to.include({ name: 'the-component', version: '1.0' })
        let pageOne = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(pageOne).to.exist()
        let pageTwo = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-two.adoc')
        expect(pageTwo).to.not.exist()
        expect(aggregate[1]).to.include({ name: 'the-component', version: '2.0' })
        pageOne = aggregate[1].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(pageOne).to.exist()
        pageTwo = aggregate[1].files.find((file) => file.path === 'modules/ROOT/pages/page-two.adoc')
        expect(pageTwo).to.exist()
      })
    })

    describe('should merge component properties for same component version', () => {
      testAll(async (repoBuilderA, repoBuilderB) => {
        const componentDescA = {
          repoName: 'the-component-repo-a',
          name: 'the-component',
          title: 'The Vetoed Component Title',
          version: 'v1.2.3',
          nav: ['nav.adoc'],
        }
        await initRepoWithFiles(repoBuilderA, componentDescA, [])
        playbookSpec.content.sources.push({ url: repoBuilderA.url })
        const componentDescB = {
          repoName: 'the-component-repo-b',
          name: 'the-component',
          title: 'The Real Component Title',
          version: 'v1.2.3',
        }
        await initRepoWithFiles(repoBuilderB, componentDescB, [])
        playbookSpec.content.sources.push({ url: repoBuilderB.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.deep.include({
          name: 'the-component',
          title: 'The Real Component Title',
          version: 'v1.2.3',
          nav: ['nav.adoc'],
        })
      }, 2)
    })
  })

  describe('aggregate files from worktree', () => {
    const initRepoWithFilesAndWorktree = async (repoBuilder, componentDesc, beforeClose) => {
      componentDesc = { name: 'the-component', version: 'v1.2.3', ...componentDesc }
      const repoName = componentDesc.repoName || componentDesc.name
      delete componentDesc.repoName
      return repoBuilder
        .init(repoName)
        .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
        .then(() =>
          repoBuilder.addFilesFromFixture([
            'README.adoc',
            'modules/ROOT/_attributes.adoc',
            'modules/ROOT/pages/_attributes.adoc',
            'modules/ROOT/pages/page-one.adoc',
          ])
        )
        .then(() => repoBuilder.copyToWorktree(['modules/ROOT/pages/page-two.adoc'], repoBuilder.fixtureBase))
        .then(() => beforeClose && beforeClose())
        .then(() => repoBuilder.close())
    }

    describe('should catalog files in worktree', () => {
      it('in local repo', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithFilesAndWorktree(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: 'v1.2.3' })
        const expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
          'modules/ROOT/pages/page-two.adoc',
        ]
        const files = aggregate[0].files
        expect(files).to.have.lengthOf(expectedPaths.length)
        const paths = files.map((file) => file.path)
        const relatives = files.map((file) => file.relative)
        expect(paths).to.have.members(expectedPaths)
        expect(relatives).to.have.members(expectedPaths)
      })

      it('in linked worktree', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const repoName = 'the-component'
        const version = '1.2'
        const dir = ospath.join(repoBuilder.repoBase, repoName)
        const linkedWorktreeRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const linkedWorktreeRepoName = 'the-component-v1.2.x'
        const linkedWorktreeDir = ospath.join(linkedWorktreeRepoBuilder.repoBase, linkedWorktreeRepoName)
        const linkedWorktreeDotgit = ospath.join(linkedWorktreeDir, '.git')
        const linkedWorktreeGitdir = ospath.join(dir, '.git/worktrees/v1.2.x')
        const pageOnePath = 'modules/ROOT/pages/page-one.adoc'
        const pageThreePath = 'modules/ROOT/pages/page-three.adoc'
        await initRepoWithFilesAndWorktree(repoBuilder, { version }, () =>
          repoBuilder
            .addToWorktree('.git/worktrees/v1.2.x/HEAD', 'ref: refs/heads/v1.2.x\n')
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/commondir', '../..\n'))
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/gitdir', linkedWorktreeDotgit + '\n'))
            .then(() => repoBuilder.checkoutBranch('v1.2.x'))
            .then(() => repoBuilder.checkoutBranch('main'))
            .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: '2.0' }))
            .then(() => repoBuilder.commitSelect(['antora.yml'], 'add new version'))
            .then(() => repoBuilder.addToWorktree(pageOnePath, '= Page One (Main Worktree)\n\ncontent\n'))
        )
        await initRepoWithFilesAndWorktree(
          linkedWorktreeRepoBuilder,
          { repoName: linkedWorktreeRepoName, version },
          () =>
            linkedWorktreeRepoBuilder
              .addToWorktree(pageThreePath, '= Page Three\n\ncontent\n')
              .then(() => wipeSync(linkedWorktreeRepoBuilder.repository.gitdir))
              .then(() => linkedWorktreeRepoBuilder.addToWorktree('.git', 'gitdir: ' + linkedWorktreeGitdir + '\n'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD, v*', worktrees: '*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(2)
        sortAggregate(aggregate)
        let componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: '1.2' })
        let expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
          'modules/ROOT/pages/page-two.adoc',
          'modules/ROOT/pages/page-three.adoc',
        ]
        let files = componentVersion.files
        expect(files).to.have.lengthOf(expectedPaths.length)
        expect(files.map((file) => file.relative)).to.have.members(expectedPaths)
        const pageThree = files.find((it) => it.relative === pageThreePath)
        expect(pageThree.src.abspath).to.equal(ospath.join(linkedWorktreeRepoBuilder.url, pageThree.relative))
        componentVersion = aggregate[1]
        expect(componentVersion).to.include({ name: 'the-component', version: '2.0' })
        expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
        ]
        files = componentVersion.files
        expect(files).to.have.lengthOf(expectedPaths.length)
        expect(files.map((file) => file.relative)).to.have.members(expectedPaths)
        const pageOne = files.find((it) => it.relative === pageOnePath)
        expect(pageOne.contents.toString()).to.include('= Page One\n')
        expect(pageOne.src.abspath).to.be.undefined()
      })

      it('in linked worktree in detached HEAD state', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const repoName = 'the-component'
        const version = '1.2'
        const dir = ospath.join(repoBuilder.repoBase, repoName)
        const linkedWorktreeRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const linkedWorktreeRepoName = 'the-component-v1.2.x'
        const linkedWorktreeDir = ospath.join(linkedWorktreeRepoBuilder.repoBase, linkedWorktreeRepoName)
        const linkedWorktreeDotgit = ospath.join(linkedWorktreeDir, '.git')
        const linkedWorktreeGitdir = ospath.join(dir, '.git/worktrees/v1.2.x')
        await initRepoWithFilesAndWorktree(repoBuilder, { version }, () =>
          repoBuilder
            .checkoutBranch('v1.2.x')
            .then(() => repoBuilder.getHeadCommit())
            .then((oid) => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/HEAD', oid + '\n'))
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/commondir', '../..\n'))
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/gitdir', linkedWorktreeDotgit + '\n'))
            .then(() => repoBuilder.checkoutBranch('main'))
        )
        await initRepoWithFilesAndWorktree(
          linkedWorktreeRepoBuilder,
          { repoName: linkedWorktreeRepoName, version },
          () =>
            linkedWorktreeRepoBuilder
              .addToWorktree('modules/ROOT/pages/page-three.adoc', '= Page Three\n\ncontent\n')
              .then(() => wipeSync(linkedWorktreeRepoBuilder.repository.gitdir))
              .then(() => linkedWorktreeRepoBuilder.addToWorktree('.git', 'gitdir: ' + linkedWorktreeGitdir + '\n'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*', worktrees: true })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: '1.2' })
        const expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
          'modules/ROOT/pages/page-two.adoc',
          'modules/ROOT/pages/page-three.adoc',
        ]
        const files = aggregate[0].files
        expect(files).to.have.lengthOf(expectedPaths.length)
        expect(files.map((file) => file.relative)).to.have.members(expectedPaths)
        const pageThree = files.find((it) => it.relative === 'modules/ROOT/pages/page-three.adoc')
        expect(pageThree.src.abspath).to.equal(ospath.join(linkedWorktreeRepoBuilder.url, pageThree.relative))
      })

      it('should skip main worktree if content source url points to .git folder', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const version = '1.2'
        await initRepoWithFilesAndWorktree(repoBuilder, { version }, () => repoBuilder.checkoutBranch('v1.2.x'))
        playbookSpec.content.sources.push({ url: repoBuilder.url + '/.git', branches: 'v1.2.x' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version })
        const expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
        ]
        const files = aggregate[0].files
        expect(files).to.have.lengthOf(expectedPaths.length)
        expect(files.map((file) => file.relative)).to.have.members(expectedPaths)
        const pageTwo = files.find((it) => it.relative === 'modules/ROOT/pages/page-two.adoc')
        expect(pageTwo).to.be.undefined()
      })

      it('in main and linked worktree', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const repoName = 'the-component'
        const version = '1.2'
        const dir = ospath.join(repoBuilder.repoBase, repoName)
        const linkedWorktreeRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const linkedWorktreeRepoName = 'the-component-v1.2.x'
        const linkedWorktreeDir = ospath.join(linkedWorktreeRepoBuilder.repoBase, linkedWorktreeRepoName)
        const linkedWorktreeDotgit = ospath.join(linkedWorktreeDir, '.git')
        const linkedWorktreeGitdir = ospath.join(dir, '.git/worktrees/v1.2.x')
        const pageOnePath = 'modules/ROOT/pages/page-one.adoc'
        await initRepoWithFilesAndWorktree(repoBuilder, { version }, () =>
          repoBuilder
            .addToWorktree('.git/worktrees/v1.2.x/HEAD', 'ref: refs/heads/v1.2.x\n')
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/commondir', '../..\n'))
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/gitdir', linkedWorktreeDotgit + '\n'))
            .then(() => repoBuilder.checkoutBranch('v1.2.x'))
            .then(() => repoBuilder.checkoutBranch('main'))
            .then(() => repoBuilder.addComponentDescriptor({ name: 'the-component', version: '2.0' }))
            .then(() => repoBuilder.commitAll('add new version'))
            .then(() => repoBuilder.addToWorktree(pageOnePath, '= Page One (Main Worktree)\n\ncontent\n'))
        )
        await initRepoWithFilesAndWorktree(
          linkedWorktreeRepoBuilder,
          { repoName: linkedWorktreeRepoName, version },
          () =>
            linkedWorktreeRepoBuilder
              .addToWorktree(pageOnePath, '= Page One (Linked Worktree)\n\ncontent\n')
              .then(() => wipeSync(linkedWorktreeRepoBuilder.repository.gitdir))
              .then(() => linkedWorktreeRepoBuilder.addToWorktree('.git', 'gitdir: ' + linkedWorktreeGitdir + '\n'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD, v*', worktrees: '., v*' })
        const aggregate = await aggregateContent(playbookSpec)
        sortAggregate(aggregate)
        expect(aggregate).to.have.lengthOf(2)
        expect(aggregate[0]).to.include({ name: 'the-component', version: '1.2' })
        const pageOne1 = aggregate[0].files.find((it) => it.relative === pageOnePath)
        expect(pageOne1.contents.toString()).to.include('= Page One (Linked Worktree)\n')
        expect(pageOne1.src.abspath).to.equal(ospath.join(linkedWorktreeRepoBuilder.url, pageOne1.relative))
        expect(aggregate[1]).to.include({ name: 'the-component', version: '2.0' })
        const pageOne2 = aggregate[1].files.find((it) => it.relative === pageOnePath)
        expect(pageOne2.contents.toString()).to.include('= Page One (Main Worktree)\n')
        expect(pageOne2.src.abspath).to.equal(ospath.join(repoBuilder.url, pageOne2.relative))
      })

      it('should skip linked worktree if selected branch is not checked out', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const repoName = 'the-component'
        const version = '1.2'
        const dir = ospath.join(repoBuilder.repoBase, repoName)
        const linkedWorktreeRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const linkedWorktreeRepoName = 'the-component-v1.2.x'
        const linkedWorktreeDir = ospath.join(linkedWorktreeRepoBuilder.repoBase, linkedWorktreeRepoName)
        const linkedWorktreeDotgit = ospath.join(linkedWorktreeDir, '.git')
        const linkedWorktreeGitdir = ospath.join(dir, '.git/worktrees/v1.2.x')
        await initRepoWithFilesAndWorktree(repoBuilder, { version }, () =>
          repoBuilder
            .addToWorktree('.git/worktrees/v1.2.x/HEAD', 'ref: refs/heads/v2.0.x\n')
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/commondir', '../..\n'))
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/gitdir', linkedWorktreeDotgit + '\n'))
            .then(() => repoBuilder.checkoutBranch('v1.2.x'))
            .then(() => repoBuilder.checkoutBranch('v2.0.x'))
            .then(() => repoBuilder.checkoutBranch('main'))
        )
        await initRepoWithFilesAndWorktree(
          linkedWorktreeRepoBuilder,
          { repoName: linkedWorktreeRepoName, version },
          () =>
            linkedWorktreeRepoBuilder
              .addToWorktree('modules/ROOT/pages/page-one.adoc', '= Page One (Worktree)\n\ncontent\n')
              .then(() => wipeSync(linkedWorktreeRepoBuilder.repository.gitdir))
              .then(() => linkedWorktreeRepoBuilder.addToWorktree('.git', 'gitdir: ' + linkedWorktreeGitdir + '\n'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v1.*', worktrees: true })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: '1.2' })
        const expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
        ]
        const files = aggregate[0].files
        expect(files).to.have.lengthOf(expectedPaths.length)
        expect(files.map((file) => file.relative)).to.have.members(expectedPaths)
        const pageOne = files.find((it) => it.relative === 'modules/ROOT/pages/page-one.adoc')
        expect(pageOne.contents.toString()).to.include('= Page One\n')
        expect(pageOne.src.abspath).to.be.undefined()
        const pageTwo = files.find((it) => it.relative === 'modules/ROOT/pages/page-two.adoc')
        expect(pageTwo).to.be.undefined()
      })

      it('should skip linked worktree if worktree name not matched by worktrees pattern', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const repoName = 'the-component'
        const version = '1.2'
        const dir = ospath.join(repoBuilder.repoBase, repoName)
        const linkedWorktreeRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        const linkedWorktreeRepoName = 'the-component-v1.2.x'
        const linkedWorktreeDir = ospath.join(linkedWorktreeRepoBuilder.repoBase, linkedWorktreeRepoName)
        const linkedWorktreeDotgit = ospath.join(linkedWorktreeDir, '.git')
        const linkedWorktreeGitdir = ospath.join(dir, '.git/worktrees/v1.2.x')
        await initRepoWithFilesAndWorktree(repoBuilder, { version }, () =>
          repoBuilder
            .addToWorktree('.git/worktrees/v1.2.x/HEAD', 'ref: refs/heads/v1.2.x\n')
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/commondir', '../..\n'))
            .then(() => repoBuilder.addToWorktree('.git/worktrees/v1.2.x/gitdir', linkedWorktreeDotgit + '\n'))
            .then(() => repoBuilder.checkoutBranch('v1.2.x'))
            .then(() => repoBuilder.checkoutBranch('main'))
        )
        await initRepoWithFilesAndWorktree(
          linkedWorktreeRepoBuilder,
          { repoName: linkedWorktreeRepoName, version },
          () =>
            linkedWorktreeRepoBuilder
              .addToWorktree('modules/ROOT/pages/page-one.adoc', '= Page One (Worktree)\n\ncontent\n')
              .then(() => wipeSync(linkedWorktreeRepoBuilder.repository.gitdir))
              .then(() => linkedWorktreeRepoBuilder.addToWorktree('.git', 'gitdir: ' + linkedWorktreeGitdir + '\n'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v1.*', worktrees: 'v2.*' })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: '1.2' })
        const expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
        ]
        const files = aggregate[0].files
        expect(files).to.have.lengthOf(expectedPaths.length)
        expect(files.map((file) => file.relative)).to.have.members(expectedPaths)
        const pageOne = files.find((it) => it.relative === 'modules/ROOT/pages/page-one.adoc')
        expect(pageOne.contents.toString()).to.include('= Page One\n')
        expect(pageOne.src.abspath).to.be.undefined()
        const pageTwo = files.find((it) => it.relative === 'modules/ROOT/pages/page-two.adoc')
        expect(pageTwo).to.be.undefined()
      })

      it('should set src.abspath and src.origin.worktree properties on files taken from worktree', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithFilesAndWorktree(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: 'v1.2.3' })
        const expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
          'modules/ROOT/pages/page-two.adoc',
        ].map((p) => ospath.join(repoBuilder.repoPath, p))
        const files = aggregate[0].files
        expect(files).to.have.lengthOf(expectedPaths.length)
        expect(files[0].src).to.have.property('abspath')
        const paths = files.map((file) => file.src.abspath)
        expect(paths).to.have.members(expectedPaths)
        files.forEach((file) => expect(file).to.have.nested.property('src.origin.worktree', repoBuilder.repoPath))
      })

      it('should set src.fileUri property on files taken from worktree', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
        await initRepoWithFilesAndWorktree(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: 'v1.2.3' })
        const fileUriBase = pathToFileURL(repoBuilder.repoPath)
        const expectedUrls = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
          'modules/ROOT/pages/page-two.adoc',
        ].map((p) => fileUriBase + '/' + p)
        const files = aggregate[0].files
        expect(files).to.have.lengthOf(expectedUrls.length)
        expect(files[0].src).to.have.property('fileUri')
        const fileUris = files.map((file) => file.src.fileUri)
        expect(fileUris).to.have.members(expectedUrls)
      })

      it('should populate file with correct contents from worktree of clone', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFilesAndWorktree(repoBuilder)
        const clonePath = ospath.join(CONTENT_REPOS_DIR, 'clone')
        await RepositoryBuilder.clone(repoBuilder.url, clonePath)
        const wipPageContents = heredoc`
          = WIP

          This is going to be something special.
        `
        await fsp.writeFile(ospath.join(clonePath, 'modules/ROOT/pages/wip-page.adoc'), wipPageContents)
        playbookSpec.content.sources.push({ url: clonePath })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        const files = aggregate[0].files
        const pageOne = files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(pageOne.contents.toString()).to.equal(
          heredoc`
          = Page One
          ifndef::env-site,env-github[]
          include::_attributes.adoc[]
          endif::[]
          :keywords: foo, bar

          Hey World!
          ` + '\n'
        )
        const wipPage = files.find((file) => file.path === 'modules/ROOT/pages/wip-page.adoc')
        expect(wipPage.contents.toString()).to.equal(wipPageContents)
      })
    })

    describe('should not catalog files in worktree', () => {
      const testNonWorktreeAggregate = async (repoBuilder) => {
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        const componentVersion = aggregate[0]
        expect(componentVersion).to.include({ name: 'the-component', version: 'v1.2.3' })
        const expectedPaths = [
          'README.adoc',
          'modules/ROOT/_attributes.adoc',
          'modules/ROOT/pages/_attributes.adoc',
          'modules/ROOT/pages/page-one.adoc',
        ]
        const files = componentVersion.files
        expect(files).to.have.lengthOf(expectedPaths.length)
        const paths = files.map((file) => file.path)
        const relatives = files.map((file) => file.relative)
        expect(paths).to.have.members(expectedPaths)
        expect(relatives).to.have.members(expectedPaths)
      }

      it('on local bare repo', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { bare: true })
        await initRepoWithFilesAndWorktree(repoBuilder)
        await testNonWorktreeAggregate(repoBuilder)
      })

      it('on remote repo', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFilesAndWorktree(repoBuilder)
        await testNonWorktreeAggregate(repoBuilder)
      })

      // NOTE this test verifies we can clone a remote repository by pointing to the .git sub-directory
      it('on remote bare repo', async () => {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFilesAndWorktree(repoBuilder)
        repoBuilder.url += '/.git'
        expect(repoBuilder.url).to.match(/\.git\/\.git$/)
        await testNonWorktreeAggregate(repoBuilder)
      })
    })
  })

  describe('content cache', () => {
    describe('should clone repository into cache folder', () => {
      testAll(
        async (repoBuilder) => {
          await initRepoWithFiles(repoBuilder)
          if (repoBuilder.remote && repoBuilder.bare) repoBuilder.url += '/.git'
          playbookSpec.content.sources.push({ url: repoBuilder.url })
          await aggregateContent(playbookSpec)
          if (repoBuilder.remote) {
            const repoDir = generateCloneFolderName(repoBuilder.url)
            expect(CONTENT_CACHE_DIR).to.be.a.directory()
            expect(ospath.join(CONTENT_CACHE_DIR, repoDir))
              .to.be.a.directory()
              .and.not.include.subDirs(['.git'])
              .and.include.files(['HEAD', 'valid'])
          } else {
            expect(CONTENT_CACHE_DIR).to.be.a.directory().and.be.empty()
          }
        },
        1,
        true
      )
    })

    it('should create bare repository with detached HEAD under cache directory', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      const defaultBranch = 'tip'
      await initRepoWithFiles(repoBuilder, undefined, undefined, () => repoBuilder.checkoutBranch(defaultBranch))
      playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD' })
      let aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.have.nested.property('files[0].src.origin.branch', defaultBranch)
      expect(aggregate[0]).to.have.nested.property('files[0].src.origin.refname', defaultBranch)
      expect(CONTENT_CACHE_DIR).to.be.a.directory().with.subDirs.have.lengthOf(1)
      const cachedRepoName = await fsp.readdir(CONTENT_CACHE_DIR).then((entries) => entries[0])
      expect(cachedRepoName).to.match(/\.git$/)
      const clonedRepoBuilder = new RepositoryBuilder(CONTENT_CACHE_DIR, FIXTURES_DIR, { bare: true })
      await clonedRepoBuilder.open(cachedRepoName)
      const clonePath = clonedRepoBuilder.repoPath
      expect(clonePath).to.have.extname('.git')
      expect(ospath.join(clonePath, 'refs/remotes/origin/HEAD'))
        .to.be.a.file()
        .and.have.contents.that.match(new RegExp(`^ref: refs/remotes/origin/${defaultBranch}(?=$|\n)`))
      expect(ospath.join(clonePath, 'refs/heads')).to.be.a.directory()
      //.and.empty()
      // NOTE make sure local HEAD is ignored
      await clonedRepoBuilder.checkoutBranch$1('local', 'refs/remotes/origin/HEAD')
      aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.have.nested.property('files[0].src.origin.branch', defaultBranch)
      expect(aggregate[0]).to.have.nested.property('files[0].src.origin.refname', defaultBranch)
      // NOTE make sure local HEAD is considered if remote HEAD is missing
      await fsp.rename(ospath.join(clonePath, 'refs/remotes/origin/HEAD'), ospath.join(clonePath, 'HEAD'))
      aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.have.nested.property('files[0].src.origin.branch', defaultBranch)
      expect(aggregate[0]).to.have.nested.property('files[0].src.origin.refname', defaultBranch)
    })

    it('should remove bare repository if clone fails to complete', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
      const customContentCacheDir = ospath.join(customCacheDir, CONTENT_CACHE_FOLDER)
      // create an unclonable repository
      await initRepoWithFiles(repoBuilder, {}, [], () => repoBuilder.deleteBranch('main'))
      playbookSpec.runtime.cacheDir = customCacheDir
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw()
      expect(customContentCacheDir).to.be.a.directory().with.subDirs.empty()
    })

    it('should clone repository again if valid file is not found in cached repository', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      let aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(CONTENT_CACHE_DIR).to.be.a.directory().with.subDirs.have.lengthOf(1)
      const cachedRepoName = await fsp.readdir(CONTENT_CACHE_DIR).then((entries) => entries[0])
      const cachedRepoDir = ospath.join(CONTENT_CACHE_DIR, cachedRepoName)
      expect(cachedRepoDir).to.match(/\.git$/)
      const validFile = ospath.join(cachedRepoDir, 'valid')
      const headFile = ospath.join(cachedRepoDir, 'HEAD')
      expect(validFile).to.be.a.file().and.be.empty()
      expect(headFile)
        .to.be.a.file()
        .and.have.contents.that.match(/^ref: refs\/heads\/main(?=$|\n)/)
      await fsp.writeFile(validFile, 'marker')
      await fsp.writeFile(headFile, '')
      await fsp.unlink(validFile)
      aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(cachedRepoDir).to.be.a.directory()
      expect(validFile).to.be.a.file().and.be.empty()
      expect(headFile)
        .to.be.a.file()
        .and.have.contents.that.match(/^ref: refs\/heads\/main(?=$|\n)/)
    })

    it('should create valid file on clone if another repository fails to clone', async () => {
      const repoBuilderA = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      const repoBuilderB = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilderA, { name: 'component-a', version: '1.0' }, undefined, async () => {
        for (let i = 0; i < 25; i++) {
          const path = `modules/ROOT/pages/page-${i}.adoc`
          await repoBuilderA.addToWorktree(path, Array(1000).fill('filler').join('\n\n'))
        }
        await repoBuilderA.commitAll('add filler')
      })
      await initRepoWithFiles(repoBuilderB, { name: 'component-b', version: '3.0' }, [])
      playbookSpec.content.sources.push(
        { url: repoBuilderA.url },
        { url: repoBuilderB.url.replace('-b.git', '-c.git') }
      )
      try {
        await aggregateContent(playbookSpec)
      } catch {
        expect(CONTENT_CACHE_DIR).to.be.a.directory().with.subDirs.have.lengthOf(1)
        const cachedRepoName = await fsp.readdir(CONTENT_CACHE_DIR).then((entries) => entries[0])
        const cachedRepoDir = ospath.join(CONTENT_CACHE_DIR, cachedRepoName)
        expect(cachedRepoDir).to.be.a.directory().and.include.files(['HEAD', 'valid']).and.include.subDirs(['refs'])
      }
    })

    it('should create valid file on fetch if another repository fails to clone', async () => {
      const repoBuilderA = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilderA, { name: 'component-a', version: '1.0' })
      playbookSpec.content.sources.push({ url: repoBuilderA.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(CONTENT_CACHE_DIR).to.be.a.directory().with.subDirs.have.lengthOf(1)
      const cachedRepoName = await fsp.readdir(CONTENT_CACHE_DIR).then((entries) => entries[0])
      const cachedRepoDir = ospath.join(CONTENT_CACHE_DIR, cachedRepoName)
      expect(cachedRepoDir).to.be.a.directory().and.include.files(['HEAD', 'valid']).and.include.subDirs(['refs'])
      await repoBuilderA.open().then(async () => {
        for (let i = 0; i < 25; i++) {
          const path = `modules/ROOT/pages/page-${i}.adoc`
          await repoBuilderA.addToWorktree(path, Array(1000).fill('filler').join('\n\n'))
        }
        await repoBuilderA.commitAll('add filler')
        await repoBuilderA.close()
      })
      const repoBuilderB = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilderB, { name: 'component-b', version: '3.0' }, [])
      playbookSpec.content.sources.push({ url: repoBuilderB.url.replace('-b.git', '-c.git') })
      playbookSpec.runtime.fetch = true
      try {
        await aggregateContent(playbookSpec)
      } catch {
        expect(cachedRepoDir).to.be.a.directory().and.include.files(['HEAD', 'valid']).and.include.subDirs(['refs'])
      }
    })

    it('should not attempt clone on entries in content sources beyond fetch concurrency if initial batch fails', async () => {
      const repoBuilderA = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      const componentDescA = { name: 'the-component-a', version: 'v1.0' }
      await initRepoWithFiles(repoBuilderA, componentDescA, ['modules/ROOT/pages/page-one.adoc'])
      playbookSpec.content.sources.push({ url: repoBuilderA.url })
      const repoBuilderB = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      const componentDescB = { name: 'the-component-b', version: 'v3.0' }
      await initRepoWithFiles(repoBuilderB, componentDescB, ['modules/ROOT/pages/page-one.adoc'])
      playbookSpec.content.sources.push({ url: repoBuilderB.url.replace('-b.git', '-d.git') })
      const repoBuilderC = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      const componentDescC = { name: 'the-component-c', version: null }
      await initRepoWithFiles(repoBuilderC, componentDescC, ['modules/ROOT/pages/page-one.adoc'])
      playbookSpec.content.sources.push({ url: repoBuilderC.url })
      playbookSpec.git = { fetchConcurrency: 2 }
      try {
        await aggregateContent(playbookSpec)
      } catch {
        expect(CONTENT_CACHE_DIR).to.be.a.directory().with.subDirs.have.lengthOf(1)
        const cachedRepoName = await fsp.readdir(CONTENT_CACHE_DIR).then((entries) => entries[0])
        expect(cachedRepoName).to.startWith('the-component-a-')
        const cachedRepoDir = ospath.join(CONTENT_CACHE_DIR, cachedRepoName)
        expect(cachedRepoDir).to.be.a.directory().and.include.files(['HEAD', 'valid']).and.include.subDirs(['refs'])
      }
    })

    describe('should use custom cache dir with absolute path', () => {
      testAll(async (repoBuilder) => {
        const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
        const customContentCacheDir = ospath.join(customCacheDir, CONTENT_CACHE_FOLDER)
        await initRepoWithFiles(repoBuilder)
        playbookSpec.runtime.cacheDir = customCacheDir
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        await aggregateContent(playbookSpec)
        expect(CONTENT_CACHE_DIR).to.not.be.a.path()
        if (repoBuilder.remote) {
          expect(customContentCacheDir).to.be.a.directory().and.not.be.empty()
        } else {
          expect(customContentCacheDir).to.be.a.directory().and.be.empty()
        }
      })
    })

    describe('should use custom cache dir relative to cwd', () => {
      testAll(async (repoBuilder) => {
        const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
        const customContentCacheDir = ospath.join(customCacheDir, CONTENT_CACHE_FOLDER)
        await initRepoWithFiles(repoBuilder)
        playbookSpec.runtime.cacheDir = '.antora-cache'
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        await aggregateContent(playbookSpec)
        expect(CONTENT_CACHE_DIR).to.not.be.a.path()
        if (repoBuilder.remote) {
          expect(customContentCacheDir).to.be.a.directory().and.not.be.empty()
        } else {
          expect(customContentCacheDir).to.be.a.directory().and.be.empty()
        }
      })
    })

    describe('should use custom cache dir relative to directory of playbook file', () => {
      testAll(async (repoBuilder) => {
        process.chdir(CWD)
        const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
        const customContentCacheDir = ospath.join(customCacheDir, CONTENT_CACHE_FOLDER)
        await initRepoWithFiles(repoBuilder)
        playbookSpec.dir = WORK_DIR
        playbookSpec.runtime.cacheDir = './.antora-cache'
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        await aggregateContent(playbookSpec)
        expect(CONTENT_CACHE_DIR).to.not.be.a.path()
        if (repoBuilder.remote) {
          expect(customContentCacheDir).to.be.a.directory().and.not.be.empty()
        } else {
          expect(customContentCacheDir).to.be.a.directory().and.be.empty()
        }
      })
    })

    describe('should use custom cache dir relative to user home', () => {
      testAll(async (repoBuilder) => {
        process.chdir(CWD)
        const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
        const customContentCacheDir = ospath.join(customCacheDir, CONTENT_CACHE_FOLDER)
        await initRepoWithFiles(repoBuilder)
        playbookSpec.runtime.cacheDir = prefixPath(
          '~',
          ospath.relative(os.homedir(), ospath.join(WORK_DIR, '.antora-cache'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        await aggregateContent(playbookSpec)
        expect(CONTENT_CACHE_DIR).to.not.be.a.path()
        if (repoBuilder.remote) {
          expect(customContentCacheDir).to.be.a.directory().and.not.be.empty()
        } else {
          expect(customContentCacheDir).to.be.a.directory().and.be.empty()
        }
      })
    })

    describe('should show sensible error message if cache directory cannot be created', () => {
      testAll(async (repoBuilder) => {
        const customCacheDir = ospath.join(WORK_DIR, '.antora-cache')
        // NOTE: put a file at the location of the cache directory
        await fsp.writeFile(customCacheDir, '')
        await initRepoWithFiles(repoBuilder)
        playbookSpec.runtime.cacheDir = customCacheDir
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const customContentCacheDir = ospath.join(customCacheDir, CONTENT_CACHE_FOLDER)
        const expectedMessage = `Failed to create content cache directory: ${customContentCacheDir};`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
      })
    })

    // technically, we don't know what it did w/ the remote we specified, but it should work regardless
    it('should ignore remote on cached repository', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)

      playbookSpec.content.sources.push({ url: repoBuilder.url, remote: 'upstream' })

      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
    })
  })

  describe('fetch updates', () => {
    it('should fetch updates into non-empty cached repository when runtime.fetch option is enabled', async () => {
      const fetches = []
      const recordFetch = (fetch) => {
        fetches.push(`http://${fetch.req.headers.host}/${fetch.repo}`)
        fetch.accept()
      }
      try {
        gitServer.on('fetch', recordFetch)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder, undefined, 'modules/ROOT/pages/page-one.adoc', () =>
          repoBuilder.createTag('ignored').then(() => repoBuilder.checkoutBranch('v1.2.x'))
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*', tags: 'release/*' })

        const firstAggregate = await aggregateContent(playbookSpec)

        expect(fetches).to.have.lengthOf(1)
        expect(fetches[0]).to.equal(repoBuilder.url)
        fetches.length = 0

        expect(firstAggregate).to.have.lengthOf(1)
        expect(firstAggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        let page1v1 = firstAggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(page1v1).to.exist()

        await repoBuilder
          .open()
          .then(() => repoBuilder.checkoutBranch('v2.0.x'))
          .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: 'v2.0.0' }))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-two.adoc'))
          .then(() => repoBuilder.checkoutBranch('2.0.x-releases'))
          .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: 'v2.0.1' }))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/topic-b/page-four.adoc'))
          .then(() => repoBuilder.createTag('release/2.0.1'))
          .then(() => repoBuilder.checkoutBranch('v1.2.x'))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-one.adoc', '= Page One\n\nUpdate received!'))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/topic-a/page-three.adoc'))
          .then(() => repoBuilder.close())

        playbookSpec.runtime.fetch = true
        const secondAggregate = await aggregateContent(playbookSpec)

        expect(fetches).to.have.lengthOf(1)
        expect(fetches[0]).to.equal(repoBuilder.url)
        fetches.length = 0

        expect(secondAggregate).to.have.lengthOf(3)
        sortAggregate(secondAggregate)
        expect(secondAggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        page1v1 = secondAggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(page1v1).to.exist()
        expect(page1v1.contents.toString()).to.have.string('Update received!')
        const page2v1 = secondAggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-two.adoc')
        expect(page2v1).to.not.exist()
        const page3v1 = secondAggregate[0].files.find(
          (file) => file.path === 'modules/ROOT/pages/topic-a/page-three.adoc'
        )
        expect(page3v1).to.exist()
        expect(secondAggregate[1]).to.include({ name: 'the-component', version: 'v2.0.0' })
        const page1v2 = secondAggregate[1].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(page1v2).to.exist()
        expect(page1v2.contents.toString()).to.not.have.string('Update received!')
        const page2v2 = secondAggregate[1].files.find((file) => file.path === 'modules/ROOT/pages/page-two.adoc')
        expect(page2v2).to.exist()
        expect(secondAggregate[2]).to.include({ name: 'the-component', version: 'v2.0.1' })
        const page4v2 = secondAggregate[2].files.find(
          (file) => file.path === 'modules/ROOT/pages/topic-b/page-four.adoc'
        )
        expect(page4v2).to.exist()
      } finally {
        gitServer.off('fetch', recordFetch)
      }
    })

    it('should fetch updates into partially populated cached repository when runtime.fetch option is enabled', async () => {
      const fetches = []
      const recordFetch = (fetch) => {
        fetches.push(`http://${fetch.req.headers.host}/${fetch.repo}`)
        fetch.accept()
      }
      try {
        gitServer.on('fetch', recordFetch)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await repoBuilder.init('the-component').then(() => repoBuilder.close())
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw()

        expect(fetches).to.have.lengthOf(1)
        expect(fetches[0]).to.equal(repoBuilder.url)
        fetches.length = 0

        await repoBuilder
          .open()
          .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: 'v1.0' }))
          .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-one.adoc'))
          .then(() => repoBuilder.close())

        playbookSpec.runtime.fetch = true
        const aggregate = await aggregateContent(playbookSpec)

        expect(fetches).to.have.lengthOf(1)
        expect(fetches[0]).to.equal(repoBuilder.url)
        fetches.length = 0

        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.0' })
        expect(aggregate[0].files).to.have.lengthOf(1)
        expect(aggregate[0].files[0].path).to.equal('modules/ROOT/pages/page-one.adoc')
      } finally {
        gitServer.off('fetch', recordFetch)
      }
    })

    it('should remove bare repository and reclone if fetch fails to complete', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      let aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(CONTENT_CACHE_DIR).to.be.a.directory().with.subDirs.have.lengthOf(1)
      const cachedRepoName = await fsp.readdir(CONTENT_CACHE_DIR).then((entries) => entries[0])
      const cachedRepoDir = ospath.join(CONTENT_CACHE_DIR, cachedRepoName)
      const headFile = ospath.join(cachedRepoDir, 'HEAD')
      expect(headFile)
        .to.be.a.file()
        .and.have.contents.that.match(/^ref: refs\/heads\/main(?=$|\n)/)
      // NOTE corrupt the cloned repository
      await fsp.unlink(headFile)
      await fsp.writeFile(ospath.join(cachedRepoDir, 'config'), '')
      playbookSpec.runtime.fetch = true
      aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(cachedRepoDir).to.be.a.directory()
      expect(headFile)
        .to.be.a.file()
        .and.have.contents.that.match(/^ref: refs\/heads\/main(?=$|\n)/)
    })

    it('should fetch tags not reachable from fetched commits when runtime.fetch option is enabled', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder, undefined, 'modules/ROOT/pages/page-one.adoc', () =>
        repoBuilder.checkoutBranch('v1.2.x')
      )
      playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*' })

      const firstAggregate = await aggregateContent(playbookSpec)

      expect(firstAggregate).to.have.lengthOf(1)
      expect(firstAggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
      let page1v1 = firstAggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
      expect(page1v1).to.exist()

      await repoBuilder
        .open()
        .then(() => repoBuilder.checkoutBranch('v1.2.x'))
        .then(() => repoBuilder.createTag('v1.2.3'))
        .then(() => repoBuilder.checkoutBranch('v2.0.x'))
        .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: 'v2.0.1' }))
        .then(() => repoBuilder.addFilesFromFixture('modules/ROOT/pages/page-two.adoc'))
        .then(() => repoBuilder.createTag('v2.0.1'))
        .then(() => repoBuilder.deleteBranch('v2.0.x'))
        .then(() => repoBuilder.close())

      playbookSpec.runtime.fetch = true
      playbookSpec.content.sources[0].branches = 'v2*'
      // NOTE this also verifies we can fetch tags after not fetching them originally
      playbookSpec.content.sources[0].tags = 'v*'
      const secondAggregate = await aggregateContent(playbookSpec)

      expect(secondAggregate).to.have.lengthOf(2)
      sortAggregate(secondAggregate)
      expect(secondAggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
      page1v1 = secondAggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
      expect(page1v1).to.exist()
      expect(secondAggregate[1]).to.include({ name: 'the-component', version: 'v2.0.1' })
      const page2v2 = secondAggregate[1].files.find((file) => file.path === 'modules/ROOT/pages/page-two.adoc')
      expect(page2v2).to.exist()
    })

    it('should prune branches when runtime.fetch option is enabled', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      const componentDesc = { name: 'the-component', version: '1.2' }
      await initRepoWithFiles(repoBuilder, componentDesc, 'modules/ROOT/pages/page-one.adoc', () =>
        repoBuilder
          .checkoutBranch('v1.2.x')
          .then(() => repoBuilder.commitAll('create stable version'))
          .then(() => repoBuilder.checkoutBranch('v1.1.x'))
          .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: '1.1' }))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-one.adoc', '= Page One\n\nPrevious content.'))
          .then(() => repoBuilder.commitAll('restore previous version'))
          .then(() => repoBuilder.checkoutBranch('v2.0.x'))
          .then(() => repoBuilder.addComponentDescriptor({ name: 'the-component', version: '2.0' }))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-two.adoc', '= Page Two\n\nNew content.'))
          .then(() => repoBuilder.commitAll('add new version'))
          .then(() => repoBuilder.checkoutBranch('v1.2.x'))
      )
      playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*' })

      const firstAggregate = await aggregateContent(playbookSpec)
      expect(firstAggregate).to.have.lengthOf(3)
      sortAggregate(firstAggregate)
      expect(firstAggregate.map((it) => it.version)).to.have.members(['1.1', '1.2', '2.0'])
      let page = firstAggregate
        .find((it) => it.version === '1.1')
        .files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
      expect(page.contents.toString()).to.have.string('Previous content')
      page = firstAggregate
        .find((it) => it.version === '2.0')
        .files.find((file) => file.path === 'modules/ROOT/pages/page-two.adoc')
      expect(page.contents.toString()).to.have.string('New content')

      await repoBuilder
        .open()
        .then(() => repoBuilder.checkoutBranch('v2.0.x'))
        .then(() => repoBuilder.deleteBranch('v1.1.x'))
        .then(() => repoBuilder.deleteBranch('v1.2.x'))
        .then(() => repoBuilder.close())
      playbookSpec.runtime.fetch = true

      const secondAggregate = await aggregateContent(playbookSpec)
      expect(secondAggregate).to.have.lengthOf(1)
      expect(secondAggregate[0]).to.include({ name: 'the-component', version: '2.0' })
    })

    it('should prune tags when runtime.fetch option is enabled and source has tags filter', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder, undefined, 'modules/ROOT/pages/page-one.adoc', () =>
        repoBuilder
          .checkoutBranch('v1.2.x')
          .then(() => repoBuilder.checkoutBranch('v1.1.x'))
          .then(() => repoBuilder.addComponentDescriptorToWorktree({ name: 'the-component', version: 'v1.1' }))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-one.adoc', '= Page One\n\nPrevious content.'))
          .then(() => repoBuilder.commitAll('restore previous content'))
          .then(() => repoBuilder.checkoutBranch('releases'))
          .then(() => repoBuilder.addComponentDescriptor({ name: 'the-component', version: 'v1.1.0' }))
          .then(() => repoBuilder.createTag('v1.1.0'))
          .then(() => repoBuilder.checkoutBranch('v1.2.x'))
      )
      playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*', tags: 'v*' })

      const firstAggregate = await aggregateContent(playbookSpec)
      expect(firstAggregate).to.have.lengthOf(3)
      sortAggregate(firstAggregate)
      expect(firstAggregate.map((it) => it.version)).to.have.members(['v1.1.0', 'v1.1', 'v1.2.3'])
      const page = firstAggregate
        .find((it) => it.version === 'v1.1')
        .files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
      expect(page.contents.toString()).to.have.string('Previous content')

      await repoBuilder
        .open()
        .then(() => repoBuilder.deleteBranch('v1.1.x'))
        .then(() => repoBuilder.deleteTag('v1.1.0'))
        .then(() => repoBuilder.close())
      playbookSpec.runtime.fetch = true

      const secondAggregate = await aggregateContent(playbookSpec)
      expect(secondAggregate).to.have.lengthOf(1)
      expect(secondAggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
    })

    it('should not fetch updates into cached repository when runtime.fetch option is not enabled', async () => {
      const fetches = []
      const recordFetch = (fetch) => {
        fetches.push(`http://${fetch.req.headers.host}/${fetch.repo}`)
        fetch.accept()
      }
      try {
        gitServer.on('fetch', recordFetch)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder, undefined, 'modules/ROOT/pages/page-one.adoc', () =>
          repoBuilder.checkoutBranch('v1.2.3')
        )
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v*' })

        const firstAggregate = await aggregateContent(playbookSpec)

        expect(fetches).to.have.lengthOf(1)
        expect(fetches[0]).to.equal(repoBuilder.url)
        fetches.length = 0

        expect(firstAggregate).to.have.lengthOf(1)
        expect(firstAggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        let page1v1 = firstAggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(page1v1).to.exist()

        await repoBuilder
          .open()
          .then(() => repoBuilder.checkoutBranch('v1.2.3'))
          .then(() => repoBuilder.addToWorktree('modules/ROOT/pages/page-one.adoc', '= Page One\n\nUpdate received!'))
          .then(() => repoBuilder.commitAll('content updates'))
          .then(() => repoBuilder.close())

        const secondAggregate = await aggregateContent(playbookSpec)

        expect(fetches).to.be.empty()

        expect(secondAggregate).to.have.lengthOf(1)
        expect(secondAggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
        page1v1 = secondAggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
        expect(page1v1).to.exist()
        expect(page1v1.contents.toString()).to.not.have.string('Update received!')
      } finally {
        gitServer.off('fetch', recordFetch)
      }
    })
  })

  describe('should fail to read start path located at submodule', () => {
    testLocal(async (repoBuilder) => {
      const contentRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(contentRepoBuilder)
      const addSubmodule = (cwd) =>
        new Promise((resolve, reject) => {
          execFile(
            'git',
            ['submodule', 'add', contentRepoBuilder.url],
            { cwd, windowsHide: true },
            (err, stdout, stderr) => (err ? reject(err) : resolve())
          )
        })
      await repoBuilder
        .init('delegate-component')
        .then(() => addSubmodule(repoBuilder.repoPath))
        .then(() => repoBuilder.commitAll('add submodule'))
        .then(() => repoBuilder.checkoutBranch('other'))
        .then(() => repoBuilder.close())
      playbookSpec.content.sources.push({ url: repoBuilder.url, startPath: 'the-component', branches: 'main' })
      // NOTE this error is a result of ReadObjectFail: Failed to read git object with oid <oid>
      const expectedMessage = `the start path 'the-component' does not exist in ${repoBuilder.local} (branch: main)`
      expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedMessage)
    })
  })

  it('should append missing .git suffix to URL by default', async () => {
    const fetches = []
    const recordFetch = (fetch) => {
      fetches.push(`http://${fetch.req.headers.host}/${fetch.repo}`)
      fetch.accept()
    }
    try {
      gitServer.on('fetch', recordFetch)
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutGitSuffix = repoBuilder.url.replace('.git', '')
      playbookSpec.content.sources.push({ url: urlWithoutGitSuffix })
      const aggregate = await aggregateContent(playbookSpec)
      expect(fetches).to.have.lengthOf(1)
      expect(fetches[0]).to.equal(repoBuilder.url)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
      expect(aggregate[0].files[0].src.origin.url).to.equal(urlWithoutGitSuffix)
    } finally {
      gitServer.off('fetch', recordFetch)
    }
  })

  it('should share cache between git commands', async () => {
    const cacheArgs = new Set()
    const git = require('@antora/content-aggregator/git')
    const gitCommands = ['clone', 'readBlob', 'readTree', 'resolveRef'].reduce((accum, name) => {
      git[name] = new Proxy((accum[name] = git[name]), {
        apply (target, self, args) {
          cacheArgs.add(args[0].cache)
          return Reflect.apply(target, self, args)
        },
      })
      return accum
    }, {})
    try {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(cacheArgs).to.have.lengthOf(1)
      const cache = [...cacheArgs][0]
      expect(cache).to.exist()
      const packfileCacheKey = Object.getOwnPropertySymbols(cache).find((sym) => sym.description === 'PackfileCache')
      expect(cache[packfileCacheKey]).to.be.instanceOf(Map)
    } finally {
      Object.entries(gitCommands).forEach(([name, fn]) => (git[name] = fn))
    }
  })

  if (process.env.RELEASE_VERSION && process.platform === 'linux') {
    it('should clone a remote repository with a large number of branches', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder, {}, [], async () => {
        // 750 branches triggers the high water mark inside of isomorphic-git
        for (let i = 0; i < 750; i++) {
          const version = 'v' + i
          const componentDesc = { name: 'the-component', title: 'The Component', version }
          await repoBuilder
            .checkoutBranch(version)
            .then(() => repoBuilder.addComponentDescriptorToWorktree(componentDesc))
            .then(() => repoBuilder.commitSelect(['antora.yml'], 'add version'))
        }
        await repoBuilder.checkoutBranch('main')
      })
      playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'v1' })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
    })
  }

  it('should prefer remote branches in bare repository', async () => {
    const remoteRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
    await initRepoWithFiles(remoteRepoBuilder, { repoName: 'the-component-remote' })

    const localRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { bare: true })
    await initRepoWithFiles(localRepoBuilder, { repoName: 'the-component-local' }, undefined, () =>
      localRepoBuilder
        .addToWorktree('modules/ROOT/pages/page-one.adoc', '= Local Modification')
        .then(() => localRepoBuilder.commitAll('make modification'))
        .then(() => localRepoBuilder.addRemote('origin', remoteRepoBuilder.url))
    )

    playbookSpec.content.sources.push({ url: localRepoBuilder.url })

    const aggregate = await aggregateContent(playbookSpec)
    expect(aggregate).to.have.lengthOf(1)
    const pageOne = aggregate[0].files.find((file) => file.path === 'modules/ROOT/pages/page-one.adoc')
    expect(pageOne).to.exist()
    expect(pageOne.contents.toString()).to.not.have.string('= Local Modification')
  })

  // NOTE this can happen if PRs are mapped as remote branches in a bare repository created by the user
  it('should discover local branches in a non-managed bare repository that has at least one remote branch', async () => {
    const remoteRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
    const remoteComponentDesc = {
      repoName: 'the-component-remote',
      name: 'the-component',
      version: 'v2.0',
    }
    await initRepoWithFiles(remoteRepoBuilder, remoteComponentDesc, undefined, () =>
      remoteRepoBuilder.checkoutBranch('pr/100').then(() => remoteRepoBuilder.deleteBranch('main'))
    )

    const localRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { bare: true })
    await initRepoWithFiles(localRepoBuilder, { repoName: 'the-component-local' }, undefined, () =>
      localRepoBuilder
        .addRemote('origin', remoteRepoBuilder.url)
        .then(() => localRepoBuilder.checkoutBranch('v1.2.3'))
        .then(() => localRepoBuilder.deleteBranch('main'))
    )

    playbookSpec.content.sources.push({ url: localRepoBuilder.url, branches: 'v1.2.3' })

    const aggregate = await aggregateContent(playbookSpec)
    expect(aggregate).to.have.lengthOf(1)
    expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
  })

  // NOTE this test doesn't always trigger the condition being tested; it depends on the order the refs are returned
  // FIXME use a spy to make the order determinant
  it('should discover components in specified remote', async () => {
    const remoteRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
    const remoteComponentDesc = {
      repoName: 'the-component-remote',
      name: 'the-component',
      version: 'v2.0',
    }
    // NOTE main branch in remote will get shadowed
    await initRepoWithFiles(remoteRepoBuilder, remoteComponentDesc, undefined, () =>
      remoteRepoBuilder.checkoutBranch('v2.0')
    )

    const localRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
    await initRepoWithFiles(localRepoBuilder, { repoName: 'the-component-local' }, undefined, () =>
      localRepoBuilder.addRemote('upstream', remoteRepoBuilder.url)
    )

    playbookSpec.content.sources.push({ url: localRepoBuilder.url, remote: 'upstream' })

    const aggregate = await aggregateContent(playbookSpec)
    expect(aggregate).to.have.lengthOf(2)
    sortAggregate(aggregate)
    expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
    expect(aggregate[1]).to.include({ name: 'the-component', version: 'v2.0' })
  })

  it('should not discover branches in other remotes', async () => {
    const remoteRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
    const remoteComponentDesc = {
      repoName: 'the-component-remote',
      name: 'the-component',
      version: 'v2.0',
    }
    await initRepoWithFiles(remoteRepoBuilder, remoteComponentDesc, undefined, () =>
      remoteRepoBuilder.checkoutBranch('v2.0')
    )

    const localRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR)
    await initRepoWithFiles(localRepoBuilder, { repoName: 'the-component-local' }, undefined, () =>
      localRepoBuilder.addRemote('upstream', remoteRepoBuilder.url)
    )

    playbookSpec.content.sources.push({ url: localRepoBuilder.url })

    const aggregate = await aggregateContent(playbookSpec)
    expect(aggregate).to.have.lengthOf(1)
    expect(aggregate[0]).to.include({ name: 'the-component', version: 'v1.2.3' })
  })

  describe('should support IPv6 hostname', () => {
    testRemote(async (repoBuilder) => {
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url.replace('//localhost:', '//[::1]:') })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
    })
  })

  describe('progress bars', () => {
    let repoBuilder

    beforeEach(async () => {
      playbookSpec.runtime.quiet = false
      repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder, {
        repoName: 'long-enough-name-to-trigger-a-progress-bar-when-used-as-width',
      })
      playbookSpec.content.sources.push({ url: repoBuilder.url })
    })

    it('should show progress bar when cloning a remote repository', async () => {
      return withMockStdout(
        async (lines) => {
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(lines).to.have.lengthOf.at.least(2)
          expect(lines[0]).to.include('[clone] ' + repoBuilder.url)
          expect(lines[0]).to.match(/ \[-+\]/)
          expect(lines[lines.length - 1]).to.match(/ \[#+\]/)
        },
        GIT_OPERATION_LABEL_LENGTH + 1 + repoBuilder.url.length * 2
      )
    })

    it('should show progress bar when fetching a remote repository', async () => {
      return withMockStdout(
        async (lines) => {
          await aggregateContent(playbookSpec)
          lines.length = 0
          playbookSpec.runtime.fetch = true
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(lines).to.have.lengthOf.at.least(2)
          expect(lines[0]).to.include('[fetch] ' + repoBuilder.url)
          expect(lines[0]).to.match(/ \[-+\]/)
          expect(lines[lines.length - 1]).to.match(/ \[#+\]/)
        },
        GIT_OPERATION_LABEL_LENGTH + 1 + repoBuilder.url.length * 2
      )
    })

    it('should cancel progress bar for fetch and create new one for clone if fetch fails', async () => {
      playbookSpec.runtime.quiet = true
      await aggregateContent(playbookSpec)
      const cachedRepoName = await fsp.readdir(CONTENT_CACHE_DIR).then((entries) => entries[0])
      // NOTE corrupt the cloned repository
      await fsp.writeFile(ospath.join(CONTENT_CACHE_DIR, cachedRepoName, 'config'), '')
      playbookSpec.runtime.quiet = false
      playbookSpec.runtime.fetch = true
      return withMockStdout(
        async (lines) => {
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(lines).to.have.lengthOf.at.least(2)
          expect(lines[0]).to.include('[fetch] ' + repoBuilder.url)
          expect(lines[0]).to.match(/ \[-+\]$/)
          expect(lines[1]).to.include('[fetch] ' + repoBuilder.url)
          expect(lines[1]).to.match(/ \[\?+\]$/)
          expect(lines[lines.length - 1]).to.include('[clone] ' + repoBuilder.url)
          expect(lines[lines.length - 1]).to.match(/ \[#+\]$/)
        },
        GIT_OPERATION_LABEL_LENGTH + 1 + repoBuilder.url.length * 2
      )
    })

    it('should show clone progress bar for each remote repository', async () => {
      const otherRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(otherRepoBuilder, {
        name: 'the-other-component',
        title: 'The Other Component',
        version: 'v1.0.0',
      })
      playbookSpec.content.sources.push({ url: otherRepoBuilder.url })

      return withMockStdout(
        async (lines) => {
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(2)
          expect(lines).to.have.lengthOf.at.least(4)
          const repoLines = lines.filter((l) => l.includes(repoBuilder.url))
          expect(repoLines).to.have.lengthOf.at.least(2)
          expect(repoLines[0]).to.include('[clone] ' + repoBuilder.url)
          expect(repoLines[0]).to.match(/ \[-+\]/)
          expect(repoLines[repoLines.length - 1]).to.match(/ \[#+\]/)
          const otherRepoLines = lines.filter((l) => l.includes(otherRepoBuilder.url))
          expect(otherRepoLines).to.have.lengthOf.at.least(2)
          expect(otherRepoLines[0]).to.include('[clone] ' + otherRepoBuilder.url)
          expect(otherRepoLines[0]).to.match(/ \[-+\]/)
          expect(otherRepoLines[otherRepoLines.length - 1]).to.match(/ \[#+\]/)
        },
        GIT_OPERATION_LABEL_LENGTH + 1 + Math.max(repoBuilder.url.length, otherRepoBuilder.url.length) * 2
      )
    })

    it('should show progress bars with mixed operations', async () => {
      const otherRepoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(otherRepoBuilder, {
        name: 'the-other-component',
        title: 'The Other Component',
        version: 'v1.0.0',
      })

      return withMockStdout(
        async (lines) => {
          await aggregateContent(playbookSpec)
          lines.length = 0
          playbookSpec.content.sources.push({ url: otherRepoBuilder.url })
          playbookSpec.runtime.fetch = true
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(2)
          expect(lines).to.have.lengthOf.at.least(4)
          const repoLines = lines.filter((l) => l.includes(repoBuilder.url))
          expect(repoLines[0]).to.include('[fetch] ' + repoBuilder.url)
          expect(repoLines[0]).to.match(/ \[-+\]/)
          expect(repoLines[repoLines.length - 1]).to.match(/ \[#+\]/)
          const otherRepoLines = lines.filter((l) => l.includes(otherRepoBuilder.url))
          expect(otherRepoLines[0]).to.include('[clone] ' + otherRepoBuilder.url)
          expect(otherRepoLines[0]).to.match(/ \[-+\]/)
          expect(otherRepoLines[otherRepoLines.length - 1]).to.match(/ \[#+\]/)
        },
        GIT_OPERATION_LABEL_LENGTH + 1 + repoBuilder.url.length * 2
      )
    })

    it('should truncate repository URL to fit within progress bar', async () => {
      return withMockStdout(async (lines) => {
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(lines).to.have.lengthOf.at.least(2)
        expect(lines[0]).to.include('[clone] ...' + repoBuilder.url.substr(7))
      }, repoBuilder.url.length * 2)
    })

    it('should configure progress bar to stretch the full width of the terminal', async () => {
      let widthA, widthB
      playbookSpec.runtime.fetch = true
      await withMockStdout(async (lines) => {
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(lines).to.have.lengthOf.at.least(2)
        widthA = lines[0].length
      }, 200)
      await withMockStdout(async (lines) => {
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(lines).to.have.lengthOf.at.least(2)
        widthB = lines[0].length
      }, 240)
      expect(widthB).to.be.greaterThan(widthA)
    })

    it('should not show progress bar if window is too narrow', async () => {
      return withMockStdout(async (lines) => {
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(lines).to.be.empty()
      }, 40)
    })

    it('should not show progress bar if stdout is not a TTY', async () => {
      return withMockStdout(
        async (lines) => {
          const aggregate = await aggregateContent(playbookSpec)
          expect(aggregate).to.have.lengthOf(1)
          expect(lines).to.be.empty()
        },
        120,
        false
      )
    })

    it('should not show progress bar if playbook runtime is quiet', async () => {
      return withMockStdout(async (lines) => {
        playbookSpec.runtime = { quiet: true }
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(lines).to.be.empty()
      })
    })

    it('should not show progress bar if repository is local', async () => {
      return withMockStdout(async (lines) => {
        playbookSpec.content.sources[0].url = repoBuilder.repoPath
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(lines).to.be.empty()
      })
    })

    it('should advance cursor past progress bars when error is thrown', async () => {
      return withMockStdout(async () => {
        playbookSpec.content.sources.pop()
        playbookSpec.content.sources.push({ url: 'https://gitlab.com/antora/no-such-repository-a.git' })
        playbookSpec.content.sources.push({ url: 'https://gitlab.com/antora/no-such-repository-b.git' })
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw('Content repository not found')
        expect(process.stdout.clearLine).to.have.been.called.gt(2)
      })
    })
  })

  describe('plugins', () => {
    it('should not register additional git plugins on git core', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { bare: true })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      ;['credentialManager', 'fs', 'http'].forEach((pluginName) => {
        expect(RepositoryBuilder.hasPlugin(pluginName, GIT_CORE)).to.be.false()
      })
    })

    it('should not use fs plugin specified on git core', async () => {
      try {
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { bare: true })
        await initRepoWithFiles(repoBuilder)
        const customFs = 'readFile writeFile unlink readdir mkdir rmdir stat lstat readlink symlink'.split(' ').reduce(
          (proxy, methodName) => {
            if (methodName === 'readFile') {
              proxy.readFile = function () {
                this.readFileCalled = true
                return fs.readFile(...arguments)
              }
            } else {
              proxy[methodName] = fs[methodName].bind(fs)
            }
            return proxy
          },
          new (class FsProxy {})()
        )
        RepositoryBuilder.registerPlugin('fs', customFs, GIT_CORE)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(customFs.readFileCalled).to.be.undefined()
        expect(RepositoryBuilder.getPlugin('fs', GIT_CORE)).to.equal(customFs)
      } finally {
        RepositoryBuilder.unregisterPlugin('fs', GIT_CORE)
      }
    })

    it('should use http plugin specified on git core', async () => {
      let userAgent
      const recordFetch = (fetch) => {
        userAgent = fetch.req.headers['user-agent']
        fetch.accept()
      }
      try {
        gitServer.on('fetch', recordFetch)
        const customHttp = require('@antora/content-aggregator/git/http-plugin')({
          headers: { 'user-agent': 'git/just-git-it@1.0' },
        })
        RepositoryBuilder.registerPlugin('http', customHttp, GIT_CORE)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0].files).to.not.be.empty()
        expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.true()
        expect(RepositoryBuilder.getPlugin('http', GIT_CORE)).to.equal(customHttp)
        expect(userAgent).to.equal('git/just-git-it@1.0')
      } finally {
        gitServer.off('fetch', recordFetch)
        RepositoryBuilder.unregisterPlugin('http', GIT_CORE)
      }
    })

    it('should use http plugin specified in playbook', async () => {
      let userAgent
      const recordFetch = (fetch) => {
        userAgent = fetch.req.headers['user-agent']
        fetch.accept()
      }
      try {
        const pluginSource = heredoc`
          module.exports = require('@antora/content-aggregator/git/http-plugin')({
            headers: { 'user-agent': 'git/just-git-it@1.0' },
          })
        `
        await fsp.writeFile(ospath.join(WORK_DIR, 'git-http-plugin.js'), pluginSource)
        gitServer.on('fetch', recordFetch)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder)
        playbookSpec.dir = WORK_DIR
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        playbookSpec.git = { plugins: { http: './git-http-plugin.js' } }
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0].files).to.not.be.empty()
        expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
        expect(userAgent).to.equal('git/just-git-it@1.0')
      } finally {
        gitServer.off('fetch', recordFetch)
      }
    })

    it('should allow built-in http plugin from isomorphic-git to be used', async () => {
      let userAgent
      const recordFetch = (fetch) => {
        userAgent = fetch.req.headers['user-agent']
        fetch.accept()
      }
      try {
        gitServer.on('fetch', recordFetch)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder)
        playbookSpec.dir = WORK_DIR
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        playbookSpec.git = { plugins: { http: '^:isomorphic-git/http/node' } }
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0].files).to.not.be.empty()
        expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
        // NOTE the built-in http plugin in isomorphic-git does not set the user-agent header
        expect(userAgent).to.be.undefined()
      } finally {
        gitServer.off('fetch', recordFetch)
      }
    })

    it('should allow custom http plugin to specify Authorization header', async () => {
      let authorization
      let contentType
      const recordFetch = (fetch) => {
        authorization = fetch.req.headers.authorization // NOTE simple-get lowercases the names of all headers
        contentType = fetch.req.headers['content-type']
        fetch.accept()
      }
      try {
        const pluginSource = heredoc`
          module.exports = require('@antora/content-aggregator/git/http-plugin')({
            headers: {
              Authorization: 'Basic ' + Buffer.from('token:').toString('base64'),
              'content-type': 'not-used',
            },
          })
        `
        await fsp.writeFile(ospath.join(WORK_DIR, 'git-http-plugin-with-authorization.js'), pluginSource)
        gitServer.on('fetch', recordFetch)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder)
        playbookSpec.dir = WORK_DIR
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        playbookSpec.git = { plugins: { http: './git-http-plugin-with-authorization.js' } }
        const aggregate = await aggregateContent(playbookSpec)
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0].files).to.not.be.empty()
        expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
        expect(authorization).to.equal('Basic dG9rZW46')
        expect(contentType).to.equal('application/x-git-upload-pack-request')
      } finally {
        gitServer.off('fetch', recordFetch)
      }
    })
  })

  describe('https and proxy', () => {
    let oldEnv
    let proxyServer
    let proxyServerUrl
    let secureGitServer
    let secureGitServerPort
    let serverRequests
    let proxyAuthorizationHeader
    let userAgentHeader

    const ssl = loadSslConfig()

    before(() => {
      proxyServer = http.createServer().on('connect', (request, clientSocket, head) => {
        serverRequests.push(`${proxyServerUrl} -> ${request.url} (${request.headers.connection})`)
        proxyAuthorizationHeader = request.headers['proxy-authorization']
        const [host, port = 80] = request.url.split(':', 2)
        const serverSocket = net
          .connect({ port, host }, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            serverSocket.write(head)
            serverSocket.pipe(clientSocket)
            clientSocket.pipe(serverSocket)
          })
          .on('end', () => clientSocket.destroy())
      })

      secureGitServer = new GitServer(CONTENT_REPOS_DIR, { autoCreate: false }).on('info', (info) => {
        userAgentHeader = info.req.headers['user-agent']
        info.accept()
      })
      const secureGitServerStartup = new Promise((resolve, reject) =>
        secureGitServer.listen(0, ssl, (err) => (err ? reject(err) : resolve()))
      )

      return Promise.all([once(proxyServer.listen(0), 'listening'), secureGitServerStartup]).then(() => {
        proxyServerUrl = new URL(`http://localhost:${proxyServer.address().port}`).toString()
        secureGitServerPort = secureGitServer.server.address().port
      })
    })

    beforeEach(() => {
      process.env = Object.assign({}, (oldEnv = process.env), { NODE_TLS_REJECT_UNAUTHORIZED: '0' })
      serverRequests = []
      proxyAuthorizationHeader = undefined
      userAgentHeader = undefined
    })

    afterEach(() => {
      process.env = oldEnv
    })

    after(() => closeServers(proxyServer, secureGitServer.server))

    it('should aggregate content from content source with https URL', async () => {
      const remote = { gitServerPort: secureGitServerPort, gitServerProtocol: 'https:' }
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
    })

    it('should pass user-agent header when communicating with git server', async () => {
      const remote = { gitServerPort: secureGitServerPort, gitServerProtocol: 'https:' }
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      expect(userAgentHeader).to.be.undefined()
      await aggregateContent(playbookSpec)
      expect(userAgentHeader).to.exist()
      expect(userAgentHeader).to.startWith('git/isomorphic-git@')
    })

    // NOTE this should probably not be a recoverable error
    it('should fail to clone repository with https URL if cert is unauthorized', async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'
      const remote = { gitServerPort: secureGitServerPort, gitServerProtocol: 'https:' }
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedMessage = new RegExp(`^self.signed certificate \\(url: ${regexpEscape(repoBuilder.url)}\\)`)
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedMessage)
        .with.property('recoverable', true)
    })

    it('should honor http_proxy setting when cloning repository over http', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.network = { httpProxy: proxyServerUrl }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
      expect(serverRequests).to.not.be.empty()
      expect(serverRequests[0]).to.equal(`${proxyServerUrl} -> localhost:${gitServerPort} (close)`)
      expect(proxyAuthorizationHeader).to.be.undefined()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
      expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
    })

    it('should ignore http_proxy setting if URL is excluded by no_proxy setting', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.network = { httpProxy: proxyServerUrl, noProxy: 'example.org,localhost' }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
      expect(serverRequests).to.be.empty()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
    })

    it('should ignore http_proxy setting if no_proxy setting is a wildcard', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.network = { httpProxy: proxyServerUrl, noProxy: '*' }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
      expect(serverRequests).to.be.empty()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
    })

    it('should honor https_proxy setting when cloning repository over https', async () => {
      const remote = { gitServerPort: secureGitServerPort, gitServerProtocol: 'https:' }
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.network = { httpsProxy: proxyServerUrl }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
      expect(serverRequests).to.not.be.empty()
      expect(serverRequests[0]).to.equal(`${proxyServerUrl} -> localhost:${secureGitServerPort} (close)`)
      expect(proxyAuthorizationHeader).to.be.undefined()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
    })

    it('should ignore https_proxy setting if URL is excluded by no_proxy setting', async () => {
      const remote = { gitServerPort: secureGitServerPort, gitServerProtocol: 'https:' }
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.network = { httpsProxy: proxyServerUrl, noProxy: 'example.org,localhost' }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
      expect(serverRequests).to.be.empty()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
    })

    it('should ignore https_proxy setting if no_proxy setting is a wildcard', async () => {
      const remote = { gitServerPort: secureGitServerPort, gitServerProtocol: 'https:' }
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.network = { httpsProxy: proxyServerUrl, noProxy: '*' }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(RepositoryBuilder.hasPlugin('http', GIT_CORE)).to.be.false()
      expect(serverRequests).to.be.empty()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
    })
  })

  describe('authentication', () => {
    let authorizationHeaderValue
    let credentialsRequestCount
    let credentialsSent
    let credentialsVerdict
    let skipAuthenticateIfNoAuth
    let oldEnv
    let currentResponse

    before(() => {
      oldEnv = Object.assign({}, process.env)
      // NOTE must reuse process.env object since os.homedir() caches a reference to it
      Object.assign(process.env, {
        HOME: WORK_DIR,
        USERPROFILE: WORK_DIR,
        XDG_CONFIG_HOME: ospath.join(WORK_DIR, '.local'),
      })
      const handleDelegate = gitServer.handle
      gitServer.handle = (req, res) => handleDelegate.call(gitServer, req, (currentResponse = res))
      gitServer.authenticate = ({ type, repo, user, headers }, next) => {
        authorizationHeaderValue = headers.authorization
        if (type === 'fetch') {
          if (!authorizationHeaderValue && skipAuthenticateIfNoAuth) {
            credentialsSent = {}
            next()
          } else {
            user((username, password) => {
              credentialsRequestCount++
              credentialsSent = { username, password }
              if (username === 'reject' && !password) return next('try again!')
              if (username === 'mask') {
                currentResponse.writeHead(404, 'Not Found', { 'Content-Type': 'text/plain' }).end()
                return
              }
              credentialsVerdict ? next(credentialsVerdict) : next()
            })
          }
        } else {
          next()
        }
      }
    })

    beforeEach(() => {
      authorizationHeaderValue = undefined
      credentialsRequestCount = 0
      credentialsSent = undefined
      credentialsVerdict = undefined
      skipAuthenticateIfNoAuth = undefined
    })

    after(() => {
      gitServer.authenticate = undefined
      Object.keys(process.env).forEach((name) => delete process.env[name])
      Object.assign(process.env, oldEnv)
    })

    afterEach(() => {
      currentResponse = undefined
    })

    it('should read valid credentials from URL', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      // NOTE include '=' in value to validate characters are not URL encoded
      repoBuilder.url = urlWithoutAuth.replace('//', '//u=:p=@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u=:p=').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u=', password: 'p=' })
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-embedded')
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.url', urlWithoutAuth)
    })

    it('should read credentials from URL when username is an email', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//user@example.org:p@ssw0rd@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('user@example.org:p@ssw0rd').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'user@example.org', password: 'p@ssw0rd' })
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-embedded')
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.url', urlWithoutAuth)
    })

    it('should remove empty credentials from URL', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      skipAuthenticateIfNoAuth = true
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.be.undefined()
      expect(credentialsSent).to.eql({})
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-embedded')
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.url', urlWithoutAuth)
    })

    it('should not resend empty credentials if auth is required', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedErrorMessage = `Content repository not found or requires credentials (url: ${urlWithoutAuth})`
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: HttpError: HTTP Error: 401 HTTP Basic: Access Denied')
      expect(result).to.throw(expectedErrorMessage).not.property('recoverable')
      expect(authorizationHeaderValue).to.be.undefined()
      expect(credentialsSent).to.be.undefined()
    })

    it('should remove credentials with empty username and password from URL', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//:@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      skipAuthenticateIfNoAuth = true
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.be.undefined()
      expect(credentialsSent).to.eql({})
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-embedded')
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.url', urlWithoutAuth)
    })

    it('should ignore credentials in URL with only password', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//:p@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      skipAuthenticateIfNoAuth = true
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.be.undefined()
      expect(credentialsSent).to.eql({})
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-embedded')
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.url', urlWithoutAuth)
    })

    it('should not resend credentials without a username if auth is required', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//:p@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedErrorMessage = `Content repository not found or requires credentials (url: ${urlWithoutAuth})`
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: HttpError: HTTP Error: 401 HTTP Basic: Access Denied')
      expect(result).to.throw(expectedErrorMessage).not.property('recoverable')
      expect(authorizationHeaderValue).to.be.undefined()
      expect(credentialsSent).to.be.undefined()
    })

    it('should pass empty password if only username is specified in URL', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      repoBuilder.url = repoBuilder.url.replace('//', '//u@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:').toString('base64'))
      expect(credentialsSent).to.not.be.undefined()
      expect(credentialsSent.username).to.equal('u')
      expect(credentialsSent.password).to.equal('')
      expect(aggregate).to.have.lengthOf(1)
    })

    it('should throw exception if credentials in URL are not accepted', async () => {
      credentialsVerdict = 'no entry!'
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//u:p@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedErrorMessage = `Content repository not found or credentials were rejected (url: ${urlWithoutAuth})`
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: HttpError: HTTP Error: 401 HTTP Basic: Access Denied')
      expect(result).to.throw(expectedErrorMessage).not.property('recoverable')
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
    })

    it('should fallback to credentials store if auth is required and URL has fake credentials', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//reject@')
      const credentials = urlWithoutAuth.replace('//', '//u:p@').replace('.git', '') + '\n'
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsRequestCount).to.equal(2)
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
    })

    it('should clone with valid credentials after failed attempt to clone with invalid credentials', async () => {
      credentialsVerdict = 'no entry!'
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url
      repoBuilder.url = urlWithoutAuth.replace('//', '//u:p@')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedErrorMessage = `Content repository not found or credentials were rejected (url: ${urlWithoutAuth})`
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedErrorMessage)
        .not.property('recoverable')
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(CONTENT_CACHE_DIR).to.be.a.directory().and.be.empty()
      authorizationHeaderValue = undefined
      credentialsVerdict = undefined
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
    })

    // NOTE this test would fail if the git client didn't automatically add the .git extension
    it('should add .git extension to URL if missing', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const urlWithoutAuth = repoBuilder.url.replace('.git', '')
      playbookSpec.content.sources.push({ url: urlWithoutAuth.replace('//', '//u:p@') })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files).to.not.be.empty()
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.url', urlWithoutAuth)
    })

    it('should read credentials for URL from git credential store if auth is required', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      // NOTE include '=' in value to validate characters are not URL encoded
      const credentials = ['invalid URL', repoBuilder.url.replace('//', '//u=:p=@')]
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials.join('\n') + '\n')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u=:p=').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u=', password: 'p=' })
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-required')
    })

    it('should read credentials with percent encoding for URL from git credential store if auth is required', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      // NOTE include '=' and '@' in value to validate characters are not URL encoded
      const credentials = ['invalid URL', repoBuilder.url.replace('//', '//user=@example.org:p%23@=%2F@')]
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials.join('\n') + '\n')
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('user=@example.org:p#@=/').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'user=@example.org', password: 'p#@=/' })
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-required')
    })

    it('should mark origin that requires auth with private=auth-required if not fetching updates', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = repoBuilder.url.replace('//', '//u:p@') + '\n'
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      let aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-required')
      credentialsSent = undefined
      aggregate = await aggregateContent(playbookSpec)
      expect(credentialsSent).to.be.undefined()
      expect(aggregate).to.have.lengthOf(1)
      expect(aggregate[0].files[0]).to.have.nested.property('src.origin.private', 'auth-required')
    })

    it('should mark origin as private when fetch gets valid credentials from credential store', async () => {
      const repoBuilderA = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      const repoBuilderB = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilderA, { name: 'component-a', version: '1.0' })
      await initRepoWithFiles(repoBuilderB, { name: 'component-b', version: '3.0' })
      const credentials = [repoBuilderA.url.replace('//', '//u:p@'), repoBuilderB.url.replace('//', '//u:p@')]
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials.join('\n') + '\n')
      playbookSpec.content.sources.push({ url: repoBuilderA.url }, { url: repoBuilderB.url })
      let aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(credentialsRequestCount).to.equal(2)
      expect(aggregate).to.have.lengthOf(2)
      playbookSpec.runtime.fetch = true
      credentialsSent = undefined
      credentialsRequestCount = 0
      aggregate = await aggregateContent(playbookSpec)
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(credentialsRequestCount).to.equal(2)
      expect(aggregate).to.have.lengthOf(2)
      const aggregateA = aggregate.find((it) => it.name === 'component-a')
      const aggregateB = aggregate.find((it) => it.name === 'component-b')
      expect(aggregateA.files).to.not.be.empty()
      expect(aggregateA.files[0]).to.have.nested.property('src.origin.private', 'auth-required')
      expect(aggregateB.files).to.not.be.empty()
      expect(aggregateB.files[0]).to.have.nested.property('src.origin.private', 'auth-required')
    })

    it('should match entry in git credential store if specified without .git extension', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = repoBuilder.url.replace('//', '//u:p@').replace('.git', '') + '\n'
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(aggregate).to.have.lengthOf(1)
    })

    it('should read credentials for URL host from git credential store if auth is required', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = repoBuilder.url.substr(0, repoBuilder.url.indexOf('/', 8)).replace('//', '//u:p@') + '\n'
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(aggregate).to.have.lengthOf(1)
    })

    it('should read credentials for URL from git credential store (XDG) if auth is required', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = repoBuilder.url.replace('//', '//u:p@') + '\n'
      await fsp.mkdir(ospath.join(process.env.XDG_CONFIG_HOME, 'git'), { recursive: true })
      await fsp.writeFile(ospath.join(process.env.XDG_CONFIG_HOME, 'git', 'credentials'), credentials)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(aggregate).to.have.lengthOf(1)
    })

    it('should not read credentials from git credential store (XDG) if specified credentials path does not exist', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = repoBuilder.url.replace('//', '//u:p@') + '\n'
      await fsp.mkdir(ospath.join(process.env.XDG_CONFIG_HOME, 'git'), { recursive: true })
      await fsp.writeFile(ospath.join(process.env.XDG_CONFIG_HOME, 'git', 'credentials'), credentials)
      const customGitCredentialsPath = ospath.join(WORK_DIR, '.custom-git-credentials')
      playbookSpec.git = { credentials: { path: customGitCredentialsPath } }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedMessage = `Content repository not found or requires credentials (url: ${repoBuilder.url})`
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedMessage)
        .not.property('recoverable')
    })

    it('should read credentials from specified path if auth is required', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = ['https://token@gitlab.com', 'https://git-host', repoBuilder.url.replace('//', '//u:p@')]
      const customGitCredentialsPath = ospath.join(WORK_DIR, '.custom-git-credentials')
      await fsp.writeFile(customGitCredentialsPath, credentials.join('\n') + '\n')
      playbookSpec.git = { credentials: { path: customGitCredentialsPath } }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(aggregate).to.have.lengthOf(1)
    })

    it('should read credentials from specified contents if auth is required', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = 'https://token@git-host,' + repoBuilder.url.replace('//', '//u:p@') + '\n'
      playbookSpec.git = { credentials: { contents: credentials } }
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
      expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
      expect(aggregate).to.have.lengthOf(1)
    })

    it('should not pass credentials if credential store is missing', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const expectedErrorMessage = `Content repository not found or requires credentials (url: ${repoBuilder.url})`
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedErrorMessage)
        .not.property('recoverable')
      expect(authorizationHeaderValue).to.be.undefined()
      expect(credentialsSent).to.be.undefined()
    })

    it('should not attempt to clone if credentials were rejected during fetch', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = repoBuilder.url.substr(0, repoBuilder.url.indexOf('/', 8)).replace('//', '//u:p@') + '\n'
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      const aggregate = await aggregateContent(playbookSpec)
      expect(aggregate).to.have.lengthOf(1)
      expect(CONTENT_CACHE_DIR).to.be.a.directory().and.not.be.empty()
      credentialsRequestCount = 0
      credentialsSent = undefined
      credentialsVerdict = 'denied!'
      playbookSpec.runtime.quiet = false
      playbookSpec.runtime.fetch = true
      return withMockStdout(async (lines) => {
        const expectedErrorMessage = `Content repository not found or credentials were rejected (url: ${repoBuilder.url})`
        expect(await trapAsyncError(aggregateContent, playbookSpec))
          .to.throw(expectedErrorMessage)
          .not.property('recoverable')
        expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
        expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
        expect(credentialsRequestCount).to.equal(1)
        expect(lines.filter((l) => l.startsWith('[clone]'))).to.be.empty()
        expect(CONTENT_CACHE_DIR).to.be.a.directory().and.be.empty()
      })
    })

    // NOTE this test simulates GitHub's behavior
    it('should mention credentials in error message if requested and server returns 404', async () => {
      const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
      await initRepoWithFiles(repoBuilder)
      const credentials = repoBuilder.url.substr(0, repoBuilder.url.indexOf('/', 8)).replace('//', '//mask:p@') + '\n'
      await fsp.writeFile(ospath.join(WORK_DIR, '.git-credentials'), credentials)
      playbookSpec.content.sources.push({ url: repoBuilder.url })
      playbookSpec.runtime.quiet = false
      return withMockStdout(async (lines) => {
        const expectedErrorMessage = `Content repository not found or credentials were rejected (url: ${repoBuilder.url})`
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedErrorMessage)
        expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('mask:p').toString('base64'))
        expect(credentialsSent).to.eql({ username: 'mask', password: 'p' })
        expect(credentialsRequestCount).to.equal(1)
        expect(CONTENT_CACHE_DIR).to.be.a.directory().and.be.empty()
      })
    })

    describe('custom credential manager', () => {
      afterEach(() => {
        RepositoryBuilder.unregisterPlugin('credentialManager', GIT_CORE)
      })

      it('should use registered credential manager and enhance it with status method', async () => {
        const credentialManager = {
          async fill ({ url }) {
            this.fulfilledUrl = url
            return { username: 'u', password: 'p' }
          },
          async approved ({ url }) {},
          async rejected ({ url, auth }) {},
        }
        RepositoryBuilder.registerPlugin('credentialManager', credentialManager, GIT_CORE)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
        expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
        expect(aggregate).to.have.lengthOf(1)
        expect(RepositoryBuilder.getPlugin('credentialManager', GIT_CORE)).to.equal(credentialManager)
        expect(credentialManager.fulfilledUrl).to.equal(repoBuilder.url)
      })

      it('should use credential manager specified in playbook', async () => {
        const pluginSource = heredoc`
          module.exports = {
            configure () {
              this.urls = {}
            },
            async fill ({ url }) {
              this.urls[url] = 'requested'
              return { username: 'u', password: 'p' }
            },
            async approved ({ url }) {
              this.urls[url] = 'approved'
            },
            async rejected ({ url, auth }) {
              this.urls[url] = 'rejected'
            },
          }
        `
        await fsp.writeFile(ospath.join(WORK_DIR, 'git-credential-manager-plugin.js'), pluginSource)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder)
        playbookSpec.dir = WORK_DIR
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        playbookSpec.git = { plugins: { credentialManager: './git-credential-manager-plugin.js' } }
        const aggregate = await aggregateContent(playbookSpec)
        expect(RepositoryBuilder.hasPlugin('credentialManager', GIT_CORE)).to.be.false()
        expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
        expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
        expect(aggregate).to.have.lengthOf(1)
      })

      it('should not enhance registered credential manager if it already contains a status method', async () => {
        const credentialManager = {
          async fill ({ url }) {
            this.fulfilledUrl = url
            return { username: 'u', password: 'p' }
          },
          async approved ({ url }) {},
          async rejected ({ url, auth }) {},
          status ({ url }) {
            return true
          },
        }
        RepositoryBuilder.registerPlugin('credentialManager', credentialManager, GIT_CORE)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        const aggregate = await aggregateContent(playbookSpec)
        expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
        expect(credentialsSent).to.eql({ username: 'u', password: 'p' })
        expect(aggregate).to.have.lengthOf(1)
        expect(aggregate[0].files[0].src.origin.private).to.equal('auth-required')
        expect(RepositoryBuilder.getPlugin('credentialManager', GIT_CORE)).to.equal(credentialManager)
        expect(credentialManager.fulfilledUrl).to.equal(repoBuilder.url)
      })

      it('should invoke configure method on custom credential manager if defined', async () => {
        const credentialManager = {
          configure () {
            this.configured = true
          },
          async fill ({ url }) {
            return { username: 'u', password: 'p' }
          },
          async approved ({ url }) {},
          async rejected ({ url, auth }) {},
        }
        RepositoryBuilder.registerPlugin('credentialManager', credentialManager, GIT_CORE)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder)
        playbookSpec.content.sources.push({ url: repoBuilder.url })
        await aggregateContent(playbookSpec)
        expect(authorizationHeaderValue).to.equal('Basic ' + Buffer.from('u:p').toString('base64'))
        expect(credentialManager.configured).to.be.true()
        expect(RepositoryBuilder.hasPlugin('credentialManager', GIT_CORE)).to.be.true()
        expect(RepositoryBuilder.getPlugin('credentialManager', GIT_CORE)).to.equal(credentialManager)
        expect(credentialManager.status).to.be.instanceof(Function)
        expect(credentialManager.status({ url: repoBuilder.url })).to.be.undefined()
      })
    })
  })

  describe('invalid local repository', () => {
    it('should throw meaningful error if local relative content directory does not exist', async () => {
      const invalidDir = './no-such-directory'
      const absInvalidDir = ospath.join(WORK_DIR, invalidDir)
      playbookSpec.dir = WORK_DIR
      playbookSpec.content.sources.push({ url: invalidDir })
      const expectedErrorMessage = `Local content source does not exist: ${absInvalidDir} (url: ${invalidDir})`
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedErrorMessage)
        .not.property('recoverable')
    })

    it('should throw meaningful error if local absolute content directory does not exist', async () => {
      const absInvalidDir = ospath.join(WORK_DIR, 'no-such-directory')
      playbookSpec.content.sources.push({ url: absInvalidDir })
      const expectedErrorMessage = `Local content source does not exist: ${absInvalidDir}`
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedErrorMessage)
        .not.property('recoverable')
    })

    it('should throw meaningful error if local relative content directory is not a git repository', async () => {
      const regularDir = './regular-directory'
      const absRegularDir = ospath.join(WORK_DIR, regularDir)
      fs.mkdirSync(absRegularDir, { recursive: true })
      fs.writeFileSync(ospath.join(absRegularDir, 'antora.xml'), 'name: the-component\nversion: 1.0')
      playbookSpec.dir = WORK_DIR
      playbookSpec.content.sources.push({ url: regularDir })
      const expectedErrorMessage = `Local content source must be a git repository: ${absRegularDir} (url: ${regularDir})`
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedErrorMessage)
        .not.property('recoverable')
    })

    it('should throw meaningful error if local absolute content directory is not a git repository', async () => {
      const absRegularDir = ospath.join(WORK_DIR, 'regular-directory')
      fs.mkdirSync(absRegularDir, { recursive: true })
      fs.writeFileSync(ospath.join(absRegularDir, 'antora.xml'), 'name: the-component\nversion: 1.0')
      playbookSpec.content.sources.push({ url: absRegularDir })
      const expectedErrorMessage = `Local content source must be a git repository: ${absRegularDir}`
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedErrorMessage)
        .not.property('recoverable')
    })

    // NOTE on Windows, : is a reserved filename character, so we can't use this test there
    if (process.platform !== 'win32') {
      it('should treat SSH URI as a remote repository', async () => {
        const repoBuilder = new RepositoryBuilder(WORK_DIR, FIXTURES_DIR)
        const repoName = 'no-such-user@localhost:no-such-repository'
        await initRepoWithFiles(repoBuilder, { repoName })
        playbookSpec.content.sources.push({ url: repoName })
        expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw()
      })
    }
  })

  describe('invalid remote repository', () => {
    let server
    let serverPort
    before(async () => {
      server = http.createServer((req, res) => {
        const headers = {}
        let body = 'No dice!'
        let stream
        let [statusCode, scenario] = req.url.split('/').slice(1, 3)
        statusCode = parseInt(statusCode, 10)
        scenario = scenario.replace(/\.git$/, '')
        if (statusCode === 401) {
          headers['WWW-Authenticate'] = 'Basic realm="example"'
        } else if (statusCode === 301) {
          headers.Location = 'http://example.org'
        } else if (statusCode === 200) {
          if (scenario === 'incomplete-ref-capabilities') {
            body = '001e# service=git-upload-pack\n0007ref\n'
          } else if (scenario === 'insufficient-capabilities') {
            body = '001e# service=git-upload-pack\n0009ref\x00\n'
          } else {
            body = '0000'
          }
          headers['Transfer-Encoding'] = 'chunked'
          stream = new Readable({
            read (size) {
              this.push(body)
              this.push(null)
            },
          })
        }
        res.writeHead(statusCode, headers)
        if (stream) {
          stream.pipe(res)
        } else {
          res.end(body)
        }
      })
      await once(server.listen(0), 'listening')
      serverPort = server.address().port
    })

    after(() => closeServer(server))

    it('should throw meaningful error if repository returns 401 error', async () => {
      const url = `http://localhost:${serverPort}/401/invalid-repository.git`
      const expectedErrorMessage = `Content repository not found or requires credentials (url: ${url})`
      playbookSpec.content.sources.push({ url })
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedErrorMessage)
        .not.property('recoverable')
    })

    // NOTE this test also verifies that the SSH URL is still shown in the progress indicator and error message
    it('should throw meaningful error when cannot connect to repository defined using SSH protocol', async () => {
      const oldSshAuthSock = process.env.SSH_AUTH_SOCK
      delete process.env.SSH_AUTH_SOCK
      const url = 'git@github.com:invalid-repository.git'
      const expectedErrorMessage = new RegExp(`^Content repository not found \\(url: ${regexpEscape(url)}\\)`)
      playbookSpec.content.sources.push({ url })
      await withMockStdout(async (lines) => {
        playbookSpec.runtime.quiet = false
        expect(await trapAsyncError(aggregateContent, playbookSpec))
          .to.throw(expectedErrorMessage)
          .not.property('recoverable')
        expect(lines[0]).to.include(url)
      })
      if (oldSshAuthSock) process.env.SSH_AUTH_SOCK = oldSshAuthSock
    })

    it('should throw meaningful error if remote repository returns internal server error', async () => {
      const url = `http://localhost:${serverPort}/500/bar.git`
      const expectedErrorMessage = `HTTP Error: 500 Internal Server Error (url: ${url})`
      playbookSpec.content.sources.push({ url })
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: HttpError: HTTP Error: 500 Internal Server Error')
      expect(result).to.throw(expectedErrorMessage).with.property('recoverable', true)
    })

    it('should throw meaningful error if git client throws exception', async () => {
      const url = `http://localhost:${serverPort}/200/incomplete-ref-capabilities.git`
      playbookSpec.content.sources.push({ url })
      const commonErrorMessage = 'Remote did not reply using the "smart" HTTP protocol.'
      const expectedErrorMessage =
        `${commonErrorMessage} Expected "001e# service=git-upload-pack" ` +
        `but received: 001e# service=git-upload-pack\n0007ref (url: ${url})`
      const expectedCauseMessage = `SmartHttpError: ${commonErrorMessage}`
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: ' + expectedCauseMessage)
      expect(result).to.throw(expectedErrorMessage).with.property('recoverable', true)
    })

    it('should throw meaningful error if git server does not support required capabilities', async () => {
      const url = `http://localhost:${serverPort}/200/insufficient-capabilities.git`
      playbookSpec.content.sources.push({ url })
      const commonErrorMessage = 'Remote did not reply using the "smart" HTTP protocol.'
      const expectedErrorMessage =
        `${commonErrorMessage} Expected "001e# service=git-upload-pack" ` +
        `but received: 001e# service=git-upload-pack\n0009ref\x00 (url: ${url})`
      const expectedCauseMessage = `SmartHttpError: ${commonErrorMessage}`
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: ' + expectedCauseMessage)
      expect(result).to.throw(expectedErrorMessage).with.property('recoverable', true)
    })

    it('should throw meaningful error if git server returns empty response', async () => {
      const url = `http://localhost:${serverPort}/200/empty-response.git`
      playbookSpec.content.sources.push({ url })
      const commonErrorMessage = 'Remote did not reply using the "smart" HTTP protocol.'
      const expectedErrorMessage = `${commonErrorMessage} Expected "001e# service=git-upload-pack" but received: 0000 (url: ${url})`
      const expectedCauseMessage = `SmartHttpError: ${commonErrorMessage}`
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: ' + expectedCauseMessage)
      expect(result).to.throw(expectedErrorMessage).with.property('recoverable', true)
    })

    it('should throw meaningful error if remote repository URL not found', async () => {
      const url = `http://localhost:${serverPort}/404/invalid-repository.git`
      const expectedErrorMessage = `Content repository not found (url: ${url})`
      playbookSpec.content.sources.push({ url })
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: HttpError: HTTP Error: 404 Not Found')
      expect(result).to.throw(expectedErrorMessage).not.property('recoverable')
    })

    describe('should not append .git suffix to URL if git.ensureGitSuffix is disabled in playbook', () => {
      testRemote(async (repoBuilder) => {
        await initRepoWithFiles(repoBuilder)
        playbookSpec.git = { ensureGitSuffix: false }
        playbookSpec.content.sources.push({ url: repoBuilder.url.replace(/\.git$/, '') })
        const expectedErrorMessage = `Content repository not found (url: ${repoBuilder.url.replace(/\.git$/, '')})`
        expect(await trapAsyncError(aggregateContent, playbookSpec))
          .to.throw(expectedErrorMessage)
          .not.property('recoverable')
      })
    })

    it('should preserve stack and details of original git error', async () => {
      const url = `http://localhost:${serverPort}/401/invalid-repository.git`
      const expectedErrorMessage = `Content repository not found or requires credentials (url: ${url})`
      playbookSpec.content.sources.push({ url })
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result)
        .to.throw(expectedErrorMessage)
        .with.property('stack')
        .that.includes('Caused by: HttpError: HTTP Error: 401 HTTP Basic: Access Denied')
        .and.includes('statusCode: 401')
        .and.includes("caller: 'git.clone'")
    })

    it('should throw meaningful error if server returns unexpected error', async () => {
      const url = `http://localhost:${serverPort}/301/invalid-repository.git`
      playbookSpec.content.sources.push({ url })
      const commonErrorMessage = 'Remote did not reply using the "smart" HTTP protocol.'
      const expectedErrorMessage = `${commonErrorMessage} Expected "001e# service=git-upload-pack"`
      expect(await trapAsyncError(aggregateContent, playbookSpec))
        .to.throw(expectedErrorMessage)
        .with.property('recoverable', true)
    })

    // NOTE Windows CI can get stuck resolving an unknown host
    if (process.platform !== 'win32') {
      it('should throw meaningful error if git host cannot be resolved', async () => {
        const url = 'https://gitlab.info/org/repository.git'
        playbookSpec.content.sources.push({ url })
        const expectedErrorMessage = `Content repository host could not be resolved: gitlab.info (url: ${url})`
        expect(await trapAsyncError(aggregateContent, playbookSpec))
          .to.throw(expectedErrorMessage)
          .not.property('recoverable')
      })
    }

    it('should show error as string if missing stack property', async () => {
      const url = `http://localhost:${serverPort}/200/repository-name.git`
      const pluginSource = heredoc`
        module.exports = {
          async request () {
            return new Promise((resolve, reject) => reject(new String('no can do')))
          },
        }
      `
      await fsp.writeFile(ospath.join(WORK_DIR, 'git-http-plugin-throws-error.js'), pluginSource)
      playbookSpec.dir = WORK_DIR
      playbookSpec.content.sources.push({ url })
      playbookSpec.git = { plugins: { http: './git-http-plugin-throws-error.js' } }
      const expectedErrorMessage = `no can do (url: ${url})`
      const result = await trapAsyncError(aggregateContent, playbookSpec)
      expect(result).to.throw(expectedErrorMessage).with.property('recoverable', true)
      expect(result).to.throw(expectedErrorMessage).with.property('stack').that.endWith('\nCaused by: no can do')
    })

    it('should not show auth information in progress bar label', async () => {
      const url = `http://0123456789@localhost:${serverPort}/401/invalid-repository.git`
      const sanitizedUrl = `http://localhost:${serverPort}/401/invalid-repository.git`
      const expectedErrorMessage = `Content repository not found or credentials were rejected (url: ${sanitizedUrl})`
      return withMockStdout(
        async (lines) => {
          playbookSpec.runtime.quiet = false
          playbookSpec.content.sources.push({ url })
          expect(await trapAsyncError(aggregateContent, playbookSpec)).to.throw(expectedErrorMessage)
          expect(lines[0]).to.not.include('0123456789@')
        },
        GIT_OPERATION_LABEL_LENGTH + 1 + url.length * 2
      )
    })
  })

  if (process.env.RELEASE_VERSION && process.platform === 'linux') {
    it('should not timeout if server does not respond in 5s', async () => {
      const fetches = []
      const trapFetch = (fetch) => {
        fetches.push(`http://${fetch.req.headers.host}/${fetch.repo} (${fetch.req.headers.connection})`)
        setTimeout(fetch.accept.bind(fetch), 5050)
      }
      try {
        gitServer.on('fetch', trapFetch)
        const repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } })
        await initRepoWithFiles(repoBuilder, undefined, 'modules/ROOT/pages/page-one.adoc')
        playbookSpec.content.sources.push({ url: repoBuilder.url, branches: 'HEAD' })
        let aggregate
        expect(await trapAsyncError(async () => (aggregate = await aggregateContent(playbookSpec)))).to.not.throw()
        expect(aggregate).to.have.lengthOf(1)
        expect(fetches).to.have.lengthOf(1)
        expect(fetches[0]).to.equal(repoBuilder.url + ' (close)')
      } finally {
        gitServer.off('fetch', trapFetch)
      }
    })
  }
})

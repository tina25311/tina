/* eslint-env mocha */
'use strict'

const {
  closeServer,
  emptyDirSync,
  expect,
  GitServer,
  heredoc,
  RepositoryBuilder,
  toJSON,
  wipeSync,
} = require('@antora/test-harness')

const fs = require('fs')
const { default: Kapok } = require('kapok-js')
const ospath = require('path')
const { version: VERSION } = require('@antora/cli/package.json')

const ANTORA_CLI = ospath.resolve('node_modules', '.bin', process.platform === 'win32' ? 'antora.cmd' : 'antora')
const CONTENT_REPOS_DIR = ospath.join(__dirname, 'content-repos')
const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')
const UI_BUNDLE_URL =
  'https://gitlab.com/antora/antora-ui-default/-/jobs/artifacts/HEAD/raw/build/ui-bundle.zip?job=bundle-stable'
const WORK_DIR = ospath.join(__dirname, 'work')
const ANTORA_CACHE_DIR = ospath.join(WORK_DIR, '.antora/cache')
const TMP_DIR = require('os').tmpdir()

Kapok.config.shouldShowLog = false

describe('cli', () => {
  let absBuildDir
  let absDestDir
  let buildDir
  let destDir
  let playbookSpec
  let playbookFile
  let repoBuilder
  let uiBundleUrl
  let gitServer

  const createContentRepository = (gitServerPort) =>
    (repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } }))
      .init('the-component')
      .then((builder) => builder.checkoutBranch('v1.0'))
      .then((builder) =>
        builder.addComponentDescriptorToWorktree({
          name: 'the-component',
          version: '1.0',
          nav: ['modules/ROOT/nav.adoc'],
        })
      )
      .then((builder) => builder.importFilesFromFixture('the-component'))
      .then((builder) => builder.checkoutBranch('v1.0-broken'))
      .then((builder) => builder.addToWorktree('modules/ROOT/pages/broken.adoc', '= Broken\n\n{no-such-attribute}'))
      .then((builder) => builder.commitAll('add broken'))
      .then((builder) => builder.close('main'))

  // NOTE run the antora command from WORK_DIR by default to simulate a typical use case
  const runAntora = (args = undefined, env = undefined, cwd = WORK_DIR) => {
    if (!Array.isArray(args)) args = args ? args.split(' ') : []
    env = { ...process.env, ANTORA_CACHE_DIR, ...env }
    return Kapok.start(ANTORA_CLI, args, { cwd, env })
  }

  before(async () => {
    emptyDirSync(CONTENT_REPOS_DIR)
    gitServer = new GitServer(CONTENT_REPOS_DIR, { autoCreate: false })
    const gitServerPort = await new Promise((resolve, reject) =>
      gitServer.listen(0, { type: 'http' }, function (err) {
        err ? reject(err) : resolve(this.address().port)
      })
    )
    await createContentRepository(gitServerPort)
    buildDir = 'build'
    absBuildDir = ospath.join(WORK_DIR, buildDir)
    destDir = ospath.join(buildDir, 'site')
    absDestDir = ospath.join(WORK_DIR, destDir)
    playbookFile = ospath.join(WORK_DIR, 'antora-playbook.json')
    uiBundleUrl = UI_BUNDLE_URL
  })

  beforeEach(() => {
    fs.mkdirSync(WORK_DIR, { recursive: true })
    try {
      fs.unlinkSync(playbookFile)
    } catch (ioe) {
      if (ioe.code !== 'ENOENT') throw ioe
    }
    // NOTE keep the default cache folder between tests
    wipeSync(absBuildDir)
    wipeSync(ospath.join(WORK_DIR, '.antora-cache-override'))
    playbookSpec = {
      runtime: { log: { format: 'json' } },
      site: { title: 'The Site' },
      content: {
        sources: [{ url: repoBuilder.repoPath, branches: 'v1.0' }],
      },
      ui: { bundle: { url: uiBundleUrl, snapshot: true } },
    }
  })

  after(async () => {
    await closeServer(gitServer.server)
    wipeSync(CONTENT_REPOS_DIR)
    if (process.env.KEEP_CACHE) {
      wipeSync(absBuildDir)
      fs.unlinkSync(playbookFile)
    } else {
      wipeSync(WORK_DIR)
    }
  })

  it('should output version when called with "-v"', () => {
    return runAntora('-v').assert(`@antora/cli: ${VERSION}`).assert(`@antora/site-generator: ${VERSION}`).done()
  })

  it('should output version when invoked with "version"', () => {
    return runAntora('version').assert(`@antora/cli: ${VERSION}`).assert(`@antora/site-generator: ${VERSION}`).done()
  })

  it('should report site generator version when invoked outside installation directory', () => {
    return runAntora('-v', { cwd: TMP_DIR })
      .assert(`@antora/cli: ${VERSION}`)
      .assert(`@antora/site-generator: ${VERSION}`)
      .done()
  })

  it('should output usage when called with no command, options, or arguments', () => {
    return runAntora()
      .assert(/^Usage: antora/)
      .done()
  })

  it('should output usage when called with "-h"', () => {
    return runAntora('-h')
      .assert(/^Usage: antora/)
      .done()
  })

  it('should output list of common options when invoked with "-h"', () => {
    // NOTE kapok removes leading spaces from output lines
    return runAntora('-h', { COLUMNS: 82 })
      .ignoreUntil(/^Options:/)
      .assert(/^-v, --version +Output the version of the CLI and default site$/)
      .assert(/^generator\.$/)
      .assert(/^-r, --require /)
      .assert(/^before executing command\.$/)
      .assert(/^--stacktrace /)
      .assert(/^application fails\.$/)
      .assert(/^-h, --help +Output usage information\.$/)
      .assert(/^Commands:/)
      .assert(/^generate /)
      .assert(/^<playbook>\.$/)
      .ignoreUntil(/^Run /)
      .assert(/^antora generate --help\)\./) // verifies help text trailer is wrapped
      .done()
  })

  it('should ignore COLUMNS environment variable with invalid value', () => {
    return runAntora('-h', { COLUMNS: 'bogus' })
      .ignoreUntil(/^Options:/)
      .assert(/^-v, --version +Output the version of the CLI and default site$/)
      .done()
  })

  it('should output list of commands when invoked with "-h"', () => {
    return runAntora('-h')
      .ignoreUntil(/^Commands:/)
      .assert(/^ *generate \[options\] <playbook>/)
      .done()
  })

  it('should output usage for generate command when invoked with "generate -h"', () => {
    return runAntora('generate -h')
      .assert(/^Usage: antora generate/)
      .done()
  })

  it('should output usage for generate command when invoked with "help generate"', () => {
    return runAntora('help generate')
      .assert(/^Usage: antora generate/)
      .done()
  })

  it('should output usage for base call when invoked with "help"', () => {
    return runAntora('help')
      .assert(/^Usage: antora/)
      .done()
  })

  it('should output warning that command does not exist when invoked with "help no-such-command"', () => {
    return runAntora('help no-such-command')
      .assert("antora: unknown command 'no-such-command'. See 'antora --help' for a list of commands.")
      .done()
  })

  it('should output options from playbook schema for generate command', () => {
    let options
    return (
      runAntora('generate -h')
        .ignoreUntil(/^Options:/)
        // -h option is always listed last
        .joinUntil(/^ *-h, --help/, { join: '\n' })
        .assert((optionsText) => {
          // NOTE unwrap lines
          options = optionsText.split('\n').reduce((accum, line) => {
            if (line.startsWith('-')) {
              accum.push(line)
            } else {
              accum.push(accum.pop() + ' ' + line)
            }
            return accum
          }, [])
          options = options.reduce((accum, line) => {
            const [sig, ...dsc] = line.split('  ')
            accum[sig.trim()] = dsc.join('').trim()
            return accum
          }, {})
          return true
        })
        .done()
        .then(() => {
          const optionForms = Object.keys(options)
          expect(optionForms).to.not.be.empty()
          expect(optionForms).to.include('--title <title>')
          expect(optionForms).to.include('--url <url>')
          expect(optionForms).to.include('--html-url-extension-style <choice>')
          // NOTE this assertion verifies the default value for an option from convict is not quoted
          expect(options['--html-url-extension-style <choice>']).to.have.string(
            '(choices: default, drop, indexify, default: default)'
          )
          expect(optionForms).to.include('--generator <generator>')
          // NOTE this assertion verifies the default value for an option defined in cli.js is not quoted
          expect(options['--generator <generator>']).to.have.string('(default: @antora/site-generator)')
          // check options are sorted, except drop -h as we know it always comes last
          expect(optionForms.slice(0, -1)).to.eql(
            Object.keys(options)
              .slice(0, -1)
              .sort((a, b) => a.localeCompare(b))
          )
        })
    )
  })

  it('should show error message if generate command is run without an argument', () => {
    return runAntora('generate')
      .assert(/^antora: missing required argument 'playbook'/)
      .done()
  })

  it('should show error message if generate command is run with multiple arguments', () => {
    return runAntora('generate antora-playbook extra-cruft')
      .assert("antora: too many arguments for 'generate'. Expected 1 argument but got 2.")
      .done()
  })

  it('should show error message if command is run with unknown global option', () => {
    return runAntora('--unknown generate antora-playbook').assert("antora: unknown option '--unknown'").done()
  })

  it('should show error message if generate command is run with unknown option', () => {
    return runAntora('generate antora-playbook --unknown').assert("antora: unknown option '--unknown'").done()
  })

  it('should show error message if default command is run with unknown option', () => {
    return runAntora('antora-playbook --unknown').assert("antora: unknown option '--unknown'").done()
  })

  it('should show error message if generate command is run with unknown option value', () => {
    const expected =
      "antora: option '--html-url-extension-style <choice>' argument 'none' is invalid. " +
      'Allowed choices are default, drop, indexify.'
    return runAntora('generate antora-playbook --html-url-extension-style=none').assert(expected).done()
  })

  it('should show error message if specified playbook file does not exist', () => {
    return runAntora('generate does-not-exist.json')
      .assert(/playbook file not found at /)
      .done()
  })

  it('should show error message if default command is run and specified playbook file does not exist', () => {
    return runAntora('does-not-exist.json')
      .assert(/playbook file not found at /)
      .done()
  })

  it('should use fallback logger to log fatal message if error is thrown before playbook is built', () => {
    playbookSpec.runtime.log.level = 'verbose'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora('generate --log-format=json antora-playbook')
      .assert(/^\[.+?\] FATAL \(antora\): runtime\.log\.level: must be one of/)
      .done()
  })

  it('should use configured logger to log fatal message if error is thrown after playbook is built', () => {
    playbookSpec.ui.bundle.url = 'does-not-exist.zip'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora('generate --log-format=json antora-playbook')
      .assert(/"msg":"Specified UI bundle does not exist: .*"/)
      .done()
  })

  // NOTE process.stdout.isTTY is always undefined when Antora is run with kapok
  it('should use pretty log format if CI=true', () => {
    delete playbookSpec.runtime
    playbookSpec.ui.bundle.url = 'does-not-exist.zip'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora('generate antora-playbook', { CI: 'true' })
      .assert(/^\[.+?\] FATAL \(antora\): Specified UI bundle does not exist: /)
      .done()
  })

  it('should show stack if --stacktrace option is specified and an exception is thrown during generation', () => {
    playbookSpec.runtime.log.format = 'fancy'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora('--stacktrace generate antora-playbook')
      .assert(/^\[.+?\] FATAL \(antora\): runtime\.log\.format: must be one of/)
      .assert(/^Cause: Error$/)
      .assert(/^at /)
      .done()
  })

  it('should show nested cause if --stacktrace option is specified and an exception is nested', () => {
    playbookSpec.output = { destinations: [{ provider: 'unknown' }] }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora('--stacktrace generate --log-format=pretty antora-playbook')
      .assert(/^\[.+?\] FATAL \(antora\): Unsupported destination provider: unknown/)
      .assert(/^Cause: Error$/)
      .assert(/^at /)
      .ignoreUntil(/^Caused by: Error: Cannot find module/)
      .assert(/^(Require stack:$|at )/)
      .done()
  })

  it('should show stack if --stacktrace option is specified and a Ruby exception with backtrace property is thrown', () => {
    playbookSpec.asciidoc = { attributes: { idseparator: 1 } }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora('--stacktrace generate --log-format=pretty antora-playbook')
      .assert(/^\[.+?\] FATAL \(asciidoctor\): .*: Failed to load AsciiDoc document/)
      .assert(/^Cause: Error$/)
      .assert(/^at Number\./)
      .done()
  })

  it('should show message if --stacktrace option is specified and an exception with no stack is thrown', () => {
    const ext = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'global-fail-tree-processor'))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora(`-r ${ext} --stacktrace generate --log-format=pretty antora-playbook`)
      .assert(/^\[.+?\] FATAL \(antora\): not today!$/)
      .assert(/^Cause: Error \(no stacktrace\)$/)
      .done()
  })

  it('should show correct type in structured log message if an exception with no stack is thrown', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = []
    return new Promise((resolve) =>
      runAntora(`--stacktrace generate --cache-dir="${playbookFile}" antora-playbook`)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.have.lengthOf(1)
      const message = messages[0]
      expect(message).to.include('{"')
      const { time, ...parsedMessage } = JSON.parse(message)
      expect(parsedMessage.msg).to.match(/Failed to create .* cache directory: .* ENOTDIR: not a directory, mkdir/)
      expect(parsedMessage.err.type).to.eql('Error')
      expect(parsedMessage.err).to.not.have.property('message')
      // Node.js >= 20 includes a stacktrace in this case
      if (parsedMessage.err.stack.includes(' at ')) {
        expect(parsedMessage.err.stack).to.startWith('Error\n')
      } else {
        expect(parsedMessage.err.stack).to.startWith('Error (no stacktrace)')
      }
    })
  })

  it('should not repeat multiline error message in stack when --stacktrace option is specified', () => {
    const playbookContents = heredoc`
      --
      site:
        title: The Site
      ui:
        bundle:
          url: ${uiBundleUrl}
    `
    fs.writeFileSync(ospath.join(WORK_DIR, 'bad-antora-playbook.yml'), playbookContents)
    return runAntora('--stacktrace generate --log-format=pretty bad-antora-playbook.yml')
      .assert(/^\[.+?\] FATAL \(antora\): end of the stream or a document separator is expected/)
      .ignoreUntil(/^-+\^/)
      .ignoreUntil(/^Cause: YAMLException$/)
      .assert(/^at generateError/)
      .done()
  })

  it('should show location of syntax error when --stacktrace option is specified', () => {
    const ext = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'extension-with-syntax-error.js'))
    playbookSpec.asciidoc = { extensions: [ext] }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora('--stacktrace generate --log-format=pretty antora-playbook')
      .assert(/^\[.+?\] FATAL \(antora\): missing \) after argument list$/)
      .assert(/^Cause: SyntaxError$/)
      .assert(/^at .*extension-with-syntax-error\.js:6/)
      .assert(/^console\.log\(doc.getDocumentTitle\(\)/)
      .done()
  })

  it('should report syntax error without line information normally when --stacktrace option is specified', () => {
    const playbookContents = heredoc`
      site:
        title: The Site
      ui:
        bundle:
          url: ${uiBundleUrl}
    `
    fs.writeFileSync(ospath.join(WORK_DIR, 'bad-antora-playbook.json'), playbookContents)
    return runAntora('--stacktrace generate --log-format=pretty bad-antora-playbook.json')
      .assert(/^\[.+?\] FATAL \(antora\): JSON5: invalid character 's' at 1:1/)
      .assert(/^Cause: SyntaxError$/)
      .assert(/^at syntaxError/)
      .done()
  })

  it('should recommend --stacktrace option if not specified and an exception is thrown during generation', () => {
    playbookSpec.runtime.log.format = 'fancy'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return runAntora('generate antora-playbook')
      .assert(/^\[.+?\] FATAL \(antora\): runtime\.log\.format: must be one of/)
      .assert('Add the --stacktrace option to see the cause of the error.')
      .done()
  })

  // NOTE this test also verifies the --playbook option is correctly inserted into the args array
  it('should generate site to output directory when extensionless playbook file is passed to generate command', () => {
    const myPlaybookFile = ospath.join(ospath.dirname(playbookFile), 'my-antora-playbook.json')
    fs.writeFileSync(myPlaybookFile, toJSON(playbookSpec))
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora('--stacktrace generate --title site-title my-antora-playbook --quiet').on('exit', resolve)
    )
      .then((exitCode) => {
        expect(exitCode).to.equal(0)
        expect(absDestDir).to.be.a.directory().with.subDirs(['_', 'the-component'])
        expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['1.0'])
        expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
          .to.be.a.file()
          .with.contents.that.match(/:: site-title<\/title>/)
      })
      .finally(() => {
        fs.unlinkSync(myPlaybookFile)
      })
  })

  it('should generate site to output directory when absolute playbook file is passed to generate command', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora(['generate', playbookFile, '--quiet']).on('exit', resolve)).then(
      (exitCode) => {
        expect(exitCode).to.equal(0)
        expect(absDestDir).to.be.a.directory().with.subDirs(['_', 'the-component'])
        expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['1.0'])
        expect(ospath.join(absDestDir, 'the-component/1.0/index.html')).to.be.a.file()
      }
    )
  })

  it('should resolve dot-relative paths in playbook relative to playbook dir', () => {
    const runCwd = ospath.join(WORK_DIR, 'some-other-folder')
    fs.mkdirSync(runCwd, { recursive: true })
    const relPlaybookFile = ospath.relative(runCwd, playbookFile)
    playbookSpec.content.sources[0].url =
      '.' + ospath.sep + ospath.relative(WORK_DIR, playbookSpec.content.sources[0].url)
    playbookSpec.ui.bundle.url =
      '.' + ospath.sep + ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'ui-bundle.zip'))
    playbookSpec.output = { dir: '.' + ospath.sep + destDir }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora(['generate', relPlaybookFile, '--quiet'], undefined, runCwd).on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(absDestDir).to.be.a.directory().with.subDirs(['_', 'the-component'])
      expect(ospath.join(absDestDir, 'the-component')).to.be.a.directory().with.subDirs(['1.0'])
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html')).to.be.a.file()
    })
  })

  describe('cache directory', () => {
    it('should store cache in cache directory passed to --cache-dir option', () => {
      playbookSpec.content.sources[0].url = repoBuilder.url
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const absCacheDir = ospath.resolve(WORK_DIR, '.antora-cache-override')
      expect(absCacheDir).to.not.be.a.path()
      // Q: how do we assert w/ kapok when there's no output; use promise as workaround
      return new Promise((resolve) =>
        runAntora(['generate', 'antora-playbook', '--cache-dir', '.antora-cache-override']).on('exit', resolve)
      ).then((exitCode) => {
        expect(exitCode).to.equal(0)
        expect(absCacheDir).to.be.a.directory().with.subDirs(['content', 'ui'])
        expect(ospath.join(absCacheDir, 'content')).to.be.a.directory().and.not.be.empty()
        expect(ospath.join(absCacheDir, 'ui')).to.be.a.directory().and.not.be.empty()
        wipeSync(absCacheDir)
      })
    })

    it('should store cache in cache directory defined by ANTORA_CACHE_DIR environment variable', () => {
      playbookSpec.content.sources[0].url = repoBuilder.url
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const absCacheDir = ospath.resolve(WORK_DIR, '.antora-cache-override')
      expect(absCacheDir).to.not.be.a.path()
      // Q: how do we assert w/ kapok when there's no output; use promise as workaround
      return new Promise((resolve) =>
        runAntora('generate antora-playbook', { ANTORA_CACHE_DIR: '.antora-cache-override' }).on('exit', resolve)
      ).then((exitCode) => {
        expect(exitCode).to.equal(0)
        expect(absCacheDir).to.be.a.directory().with.subDirs(['content', 'ui'])
        expect(ospath.join(absCacheDir, 'content')).to.be.a.directory().and.not.be.empty()
        expect(ospath.join(absCacheDir, 'ui')).to.be.a.directory().and.not.be.empty()
        wipeSync(absCacheDir)
      })
    })
  })

  it('should allow CLI option to override properties set in playbook file', () => {
    playbookSpec.runtime = { quiet: false, silent: false }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora(['generate', 'antora-playbook', '--title', 'Awesome Docs', '--silent']).on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(new RegExp('<title>Index Page :: Awesome Docs</title>'))
    })
  })

  it('should allow environment variable to override properties set in playbook file', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const env = { URL: 'https://docs.example.com' }
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora('generate antora-playbook --quiet', env).on('exit', resolve)).then(
      (exitCode) => {
        expect(exitCode).to.equal(0)
        expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
          .to.be.a.file()
          .with.contents.that.match(new RegExp('<link rel="canonical" href="https://docs.example.com/[^"]*">'))
      }
    )
  })

  it('should pass keys defined using options to UI model', () => {
    playbookSpec.site.keys = { google_analytics: 'UA-12345-1' }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // NOTE we're treating hyphens and underscores in the key name as equivalent
    const args = ['generate', 'antora-playbook', '--key', 'foo=bar', '--key', 'google-analytics=UA-67890-1']
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora(args).on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html'))
        .to.be.a.file()
        .with.contents.that.match(/src="https:\/\/www[.]googletagmanager[.]com\/gtag\/js\?id=UA-67890-1">/)
    })
  })

  it('should not remap legacy --google-analytics-key option', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = ['generate', 'antora-playbook', '--google-analytics-key', 'UA-67890-1']
    return runAntora(args).assert("antora: unknown option '--google-analytics-key'").done()
  })

  it('should pass attributes defined using options to AsciiDoc processor', () => {
    playbookSpec.asciidoc = { attributes: { idprefix: '' } }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = 'generate antora-playbook --attribute sectanchors=~ --attribute experimental --quiet'.split(' ')
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora(args).on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html'))
        .to.be.a.file()
        .with.contents.that.match(/<h2 id="section_a">Section A<\/h2>/)
        .and.with.contents.that.match(/<kbd>Ctrl<\/kbd>\+<kbd>T<\/kbd>/)
    })
  })

  it('should invoke generate command if no command is specified', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    // TODO once we have common options, we'll need to be sure they get moved before the default command
    return new Promise((resolve) =>
      runAntora('antora-playbook --url https://docs.example.com --quiet').on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(new RegExp('<link rel="canonical" href="https://docs.example.com/[^"]*">'))
    })
  })

  it('should allow CLI option name and value to be separated by an equals sign', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    // TODO once we have common options, we'll need to be sure they get moved before the default command
    return new Promise((resolve) =>
      runAntora('--title=#allthedocs --url=https://docs.example.com --quiet antora-playbook').on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(new RegExp('<title>Index Page :: #allthedocs</title>'))
        .with.contents.that.match(new RegExp('<link rel="canonical" href="https://docs.example.com/[^"]*">'))
    })
  })

  it('should use the generator specified by the --generator option', () => {
    const generator = ospath.resolve(FIXTURES_DIR, 'simple-generator')
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return new Promise((resolve) =>
      runAntora(`generate antora-playbook --generator ${generator}`).on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, '418.html'))
        .to.be.a.file()
        .with.contents.that.match(/I'm a teapot/)
    })
  })

  it('should use the generator specified in playbook', () => {
    playbookSpec.antora = { generator: ospath.resolve(FIXTURES_DIR, 'simple-generator') }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return new Promise((resolve) => runAntora('generate antora-playbook').on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, '418.html'))
        .to.be.a.file()
        .with.contents.that.match(/I'm a teapot/)
    })
  })

  it('should be able to use the alias @antora/site-generator-default as the generator', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return new Promise((resolve) =>
      runAntora('generate antora-playbook --generator @antora/site-generator-default').on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(absDestDir).to.be.a.directory().with.subDirs(['_', 'the-component'])
    })
  })

  it('should clean output directory before generating when --clean switch is used', () => {
    const residualFile = ospath.join(absDestDir, 'the-component/1.0/old-page.html')
    fs.mkdirSync(ospath.dirname(residualFile), { recursive: true })
    fs.writeFileSync(residualFile, '<!DOCTYPE html><html><body>contents</body></html>')
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora('generate antora-playbook --clean --quiet').on('exit', resolve)).then(
      (exitCode) => {
        expect(exitCode).to.equal(0)
        expect(ospath.join(absDestDir, 'the-component/1.0/index.html')).to.be.a.file()
        expect(residualFile).to.not.be.a.path()
      }
    )
  })

  it('should output to directory specified by --to-dir option', () => {
    // NOTE we must use a subdirectory of destDir so it gets cleaned up properly
    const betaDestDir = ospath.join(destDir, 'beta')
    const absBetaDestDir = ospath.join(absDestDir, 'beta')
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora(['generate', 'antora-playbook', '--to-dir', betaDestDir, '--quiet']).on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(absBetaDestDir).to.be.a.directory()
      expect(ospath.join(absBetaDestDir, 'the-component/1.0/index.html')).to.be.a.file()
    })
  })

  // NOTE this test verifies backwards compatibility with a legacy site generator
  it('should discover locally installed default site generator', () => {
    const runCwd = __dirname
    const globalModulePath = require.resolve('@antora/site-generator')
    const localNodeModules = ospath.join(WORK_DIR, 'node_modules')
    const localModulePath = ospath.join(localNodeModules, '@antora/site-generator')
    fs.mkdirSync(localModulePath, { recursive: true })
    const localScript = heredoc`module.exports = (args, env) => {
      console.log('Using custom site generator')
      const playbook = require('@antora/playbook-builder')([...args, '--title', 'Custom Site Generator'], env)
      return require(${JSON.stringify(globalModulePath)})(playbook)
    }`
    fs.writeFileSync(ospath.join(localModulePath, 'generate-site.js'), localScript)
    fs.writeFileSync(ospath.join(localModulePath, 'package.json'), toJSON({ main: 'generate-site.js' }))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const relPlaybookFile = ospath.relative(runCwd, playbookFile)
    const messages = []
    return new Promise((resolve) =>
      runAntora(['--stacktrace', 'generate', relPlaybookFile, '--quiet'], undefined, runCwd)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      wipeSync(localNodeModules)
      expect(exitCode).to.equal(0)
      expect(messages).to.include('Using custom site generator')
      expect(absDestDir).to.be.a.directory()
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(new RegExp('<title>Index Page :: Custom Site Generator</title>'))
    })
  })

  it('should show error message if require path fails to load', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    // NOTE --log-format=pretty only required if playbook is built before scripts are required
    const messages = []
    return new Promise((resolve) =>
      runAntora('-r no-such-module generate --log-format=pretty antora-playbook')
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.match(/^\[.+?\] FATAL \(antora\): Cannot find module/)
    })
  })

  it('should not show unhandled promise rejection warning if start path not found when using concurrency limit', () => {
    const url = repoBuilder.url
    playbookSpec.content.sources[0].url = url
    playbookSpec.content.sources.unshift({ url: url.replace('//', '//git@'), branches: 'v1.0', start_path: 'invalid' })
    playbookSpec.git = { fetch_concurrency: 1 }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = ['generate', '--fetch', 'antora-playbook']
    const messages = []
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages.join('\n')).to.not.include('UnhandledPromiseRejectionWarning')
      expect(messages[0]).to.match(/"msg":"the start path 'invalid' does not exist in .*"/)
    })
  })

  it('should show error message if site generator cannot be found', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = ['--stacktrace', 'generate', 'antora-playbook', '--generator', 'no-such-module']
    const messages = []
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.have.lengthOf(1)
      const message = messages[0]
      expect(message).to.include('{"')
      const parsedMessage = JSON.parse(message)
      expect(parsedMessage.msg).to.match(/^Generator not found or failed to load\. Try installing /)
      expect(parsedMessage.err.message).to.match(/^Cannot find module 'no-such-module'/)
      expect(parsedMessage.err.stack).to.match(/^Error\n *at /)
      expect(parsedMessage.err.code).to.equal('MODULE_NOT_FOUND')
      expect(parsedMessage.err).to.have.property('requireStack')
    })
  })

  it('should show error message if site generator fails to load', () => {
    const localNodeModules = ospath.join(WORK_DIR, 'node_modules')
    const localModulePath = ospath.join(localNodeModules, '@antora/site-generator')
    fs.mkdirSync(localModulePath, { recursive: true })
    fs.writeFileSync(ospath.join(localModulePath, 'index.js'), 'throw undefined')
    fs.writeFileSync(ospath.join(localModulePath, 'package.json'), toJSON({ main: 'index.js' }))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = ['--stacktrace', 'generate', 'antora-playbook', '--generator', '.:@antora/site-generator']
    const messages = []
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', (exitCode) => {
          wipeSync(localNodeModules)
          resolve(exitCode)
        })
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.have.lengthOf(1)
      const message = messages[0]
      expect(message).to.include('{"')
      const parsedMessage = JSON.parse(message)
      expect(parsedMessage.msg).to.equal('Generator not found or failed to load.')
      expect(parsedMessage.err.type).to.equal('Error')
      expect(parsedMessage.err.message).to.equal('undefined')
      expect(parsedMessage.err.stack).to.equal('Error (no stacktrace)')
    })
  })

  it('should show error message if site generator has syntax error', () => {
    const localNodeModules = ospath.join(WORK_DIR, 'node_modules')
    const localModulePath = ospath.join(localNodeModules, '@antora/site-generator')
    fs.mkdirSync(localModulePath, { recursive: true })
    const generatorSource = 'module.exports = async (playbook) => {\n  const context = new GeneratorContext(module\n}'
    fs.writeFileSync(ospath.join(localModulePath, 'index.js'), generatorSource)
    fs.writeFileSync(ospath.join(localModulePath, 'package.json'), toJSON({ main: 'index.js' }))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = ['--stacktrace', 'generate', 'antora-playbook', '--generator', '.:@antora/site-generator']
    const messages = []
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', (exitCode) => {
          wipeSync(localNodeModules)
          resolve(exitCode)
        })
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.have.lengthOf(1)
      const message = messages[0]
      expect(message).to.include('{"')
      const parsedMessage = JSON.parse(message)
      expect(parsedMessage.msg).to.equal('Generator not found or failed to load.')
      expect(parsedMessage.err.type).to.equal('SyntaxError')
      expect(parsedMessage.err.message).to.equal('missing ) after argument list')
      expect(parsedMessage.err.stack).to.match(/^SyntaxError\n *at /)
    })
  })

  it('should show error message in pretty log if site generator has syntax error', () => {
    const localNodeModules = ospath.join(WORK_DIR, 'node_modules')
    const localModulePath = ospath.join(localNodeModules, '@antora/site-generator')
    fs.mkdirSync(localModulePath, { recursive: true })
    const generatorSource = 'module.exports = async (playbook) => {\n  const context = new GeneratorContext(module\n}'
    fs.writeFileSync(ospath.join(localModulePath, 'index.js'), generatorSource)
    fs.writeFileSync(ospath.join(localModulePath, 'package.json'), toJSON({ main: 'index.js' }))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = '--stacktrace antora-playbook --log-format=pretty --generator .:@antora/site-generator'
    const messages = []
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', (exitCode) => {
          wipeSync(localNodeModules)
          resolve(exitCode)
        })
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      const lines = messages.join('').split('\n')
      expect(lines[0]).to.match(/^\[.+?\] FATAL \(antora\): Generator not found or failed to load\.$/)
      expect(lines[1]).to.match(/^ +Cause: SyntaxError: missing \) after argument list$/)
      expect(lines[2]).to.match(/^ +at .*index\.js:2/)
      expect(lines[3]).to.match(/^ +const context = new GeneratorContext\(module/)
    })
  })

  it('should exit with status code 0 if Antora extension stops generator', () => {
    const ext = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'extension-stop-before-publish.js'))
    playbookSpec.antora = { extensions: [ext] }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return new Promise((resolve) => runAntora('antora-playbook').on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(absDestDir).to.not.be.a.path()
    })
  })

  it('should allow Node.js process to terminate normally so beforeExit listeners are called', () => {
    const ext = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'extension-before-exit.js'))
    playbookSpec.antora = { extensions: [ext] }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = []
    return new Promise((resolve) =>
      runAntora('antora-playbook')
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      // because of timing, multiple lines may be combined into a single chunk
      expect(messages.join('\n').split('\n')).to.eql(['saying goodbye', 'done goodbyes', 'goodbye'])
    })
  })

  it('should exit with status code set by extension if Antora extension stops generator', () => {
    const ext = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'extension-stop-before-publish.js'))
    playbookSpec.antora = { extensions: [{ require: ext, exit_code: 2 }] }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    return new Promise((resolve) => runAntora('antora-playbook').on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(2)
      expect(absDestDir).to.not.be.a.path()
    })
  })

  it('should exit with status code 0 if log failure level is not reached', async () => {
    playbookSpec.content.sources[0].branches = 'v1.0-broken'
    playbookSpec.runtime.log.failure_level = 'fatal'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = []
    return new Promise((resolve) =>
      runAntora('generate antora-playbook')
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(messages).to.have.lengthOf(1)
      const message = messages[0]
      expect(message).to.include('{"')
      const { time, ...parsedMessage } = JSON.parse(message)
      expect(parsedMessage.msg).to.eql('skipping reference to missing attribute: no-such-attribute')
    })
  })

  it('should exit with status code 1 if log failure level is reached', async () => {
    playbookSpec.content.sources[0].branches = 'v1.0-broken'
    playbookSpec.runtime.log.failure_level = 'warn'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = []
    return new Promise((resolve) =>
      runAntora('generate antora-playbook')
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.have.lengthOf(1)
      const message = messages[0]
      expect(message).to.include('{"')
      const { time, ...parsedMessage } = JSON.parse(message)
      expect(parsedMessage.msg).to.eql('skipping reference to missing attribute: no-such-attribute')
    })
  })

  it('should exit with existing non-zero exit code if log failure level is reached', async () => {
    const ext = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'extension-stop-before-publish.js'))
    playbookSpec.antora = { extensions: [{ require: ext, exit_code: 2 }] }
    playbookSpec.content.sources[0].branches = 'v1.0-broken'
    playbookSpec.runtime.log.failure_level = 'warn'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = []
    return new Promise((resolve) =>
      runAntora('generate antora-playbook')
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(2)
      expect(messages).to.have.lengthOf(1)
      const message = messages[0]
      expect(message).to.include('{"')
      const { time, ...parsedMessage } = JSON.parse(message)
      expect(parsedMessage.msg).to.eql('skipping reference to missing attribute: no-such-attribute')
    })
  })

  it('should exit with status code 0 if error is thrown but log failure level is not reached', async () => {
    const ext = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'global-fail-tree-processor'))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = []
    return new Promise((resolve) =>
      runAntora(`generate -r ${ext} --stacktrace --log-failure-level=none antora-playbook`)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(messages).to.have.lengthOf(1)
      const message = messages[0]
      expect(message).to.include('{"')
      const { time, ...parsedMessage } = JSON.parse(message)
      expect(parsedMessage.msg).to.equal('not today!')
      expect(parsedMessage.err.type).to.equal('Error')
      expect(parsedMessage.err).to.not.have.property('message')
      expect(parsedMessage.err.stack).to.equal('Error (no stacktrace)')
    })
  })

  // this test also verifies that the --stacktrace option hint is not routed to stderr
  it('should not show error message thrown before playbook is built if --silent flag is specified', async () => {
    playbookSpec.runtime.log.foo = 'bar'
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = []
    return new Promise((resolve) =>
      runAntora('generate --silent antora-playbook')
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.be.empty()
    })
  })

  // this test also verifies that the --stacktrace option hint is not routed to stderr
  it('should not show error message thrown after playbook is built if log level is silent', async () => {
    const ext = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'global-fail-tree-processor'))
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const messages = []
    return new Promise((resolve) =>
      runAntora(`generate -r ${ext} --stacktrace --log-level=silent antora-playbook`)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.be.empty()
    })
  })

  it('should preload libraries specified using the require option', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const r1 = ospath.resolve(FIXTURES_DIR, 'warming-up.js')
    const r2 = '.' + ospath.sep + ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'global-postprocessor'))
    const args = ['--require', r1, '-r', r2, 'generate', 'antora-playbook', '--quiet']
    const messages = []
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(messages).to.include('warming up...')
      expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html'))
        .to.be.a.file()
        .with.contents.that.match(/<p>Fin!<\/p>/)
    })
  })

  it('should flush log buffer and close log file for logger on normal exit', () => {
    playbookSpec.site.start_page = 'no-such-component::index.adoc'
    playbookSpec.runtime = {
      log: {
        format: 'json',
        failure_level: 'warn',
        destination: {
          file: '.' + ospath.sep + buildDir + ospath.sep + 'antora.log',
          buffer_size: 4096,
          sync: false,
        },
      },
    }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = ['generate', 'antora-playbook']
    const messages = []
    const logFile = ospath.join(WORK_DIR, buildDir, 'antora.log')
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.be.empty()
      expect(logFile)
        .to.be.a.file()
        .with.json()
        .and.have.contents.that.match(/"msg":"Start page specified for site not found: .+"/)
    })
  })

  it('should flush log buffer and close log file for logger on unexpected exit', () => {
    playbookSpec.site.start_page = 'no-such-component::index.adoc'
    playbookSpec.runtime = {
      log: {
        format: 'json',
        destination: {
          file: '.' + ospath.sep + buildDir + ospath.sep + 'antora.log',
          buffer_size: 4096,
          sync: false,
        },
      },
    }
    playbookSpec.output = { destinations: [{ provider: 's3' }] }
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const args = ['generate', '--log-format=json', 'antora-playbook']
    const messages = []
    const logFile = ospath.join(WORK_DIR, buildDir, 'antora.log')
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(1)
      expect(messages).to.be.empty()
      expect(logFile)
        .to.be.a.file()
        //.with.json() // .with.json() doesn't understand the json lines format
        .and.have.contents.that.match(/"msg":"Start page specified for site not found: .+"/)
        .and.have.contents.that.match(/"msg":"Unsupported destination provider: s3"/)
        .and.have.contents.that.match(/"hint":"Add the --stacktrace option to see the cause of the error\."/)
    })
  })

  // Q: in this case, should the log format be pretty?
  it('should configure logger with default settings and warn if used before being configured', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const requirePath = ospath.resolve(FIXTURES_DIR, 'use-logger.js')
    const messages = []
    return new Promise((resolve) =>
      runAntora(['generate', 'antora-playbook', '-r', requirePath, '--quiet'])
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(messages).to.have.lengthOf(2)
      // a) use these assertions if the default format is json
      //expect(messages[0]).to.include('"level":"warn"')
      //expect(messages[0]).to.include('"msg":"logger not configured;')
      //expect(messages[1]).to.include('"msg":"Let\'s go!"')
      // b) use these assertions if the default format is pretty
      expect(messages[0]).to.include('WARN: logger not configured;')
      expect(messages[1]).to.include("INFO: Let's go!")
    })
  })

  /* switch to these tests if playbook is is built before scripts are required
  if (process.platform !== 'win32') {
    it('should configure logger with default settings and warn if used before being configured', () => {
      fs.writeFileSync(playbookFile, toJSON(playbookSpec))
      const requirePath = ospath.resolve(FIXTURES_DIR, 'use-logger.js')
      const messages = []
      return new Promise((resolve) =>
        runAntora(['generate', 'antora-playbook', '--quiet'], { NODE_OPTIONS: `-r "${requirePath}"` })
          .on('data', (data) => messages.push(data.message))
          .on('exit', resolve)
      ).then((exitCode) => {
        expect(exitCode).to.equal(0)
        expect(messages).to.have.lengthOf(2)
        expect(messages[0]).to.include('"level":"warn"')
        expect(messages[0]).to.include('"msg":"logger not configured;')
        expect(messages[1]).to.include('"msg":"Let\'s go!"')
      })
    })
  }

  it('should allow require script to use configured logger', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const requirePath = ospath.resolve(FIXTURES_DIR, 'use-logger.js')
    const messages = []
    return new Promise((resolve) =>
      runAntora(['generate', '-r', requirePath, '--log-level', 'info', 'antora-playbook', '--quiet'])
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(messages).to.have.lengthOf(1)
      expect(messages[0]).to.include('"msg":"Let\'s go!"')
    })
  })
  */

  it('should allow require script to replace base html5 converter that Antora extends', () => {
    fs.writeFileSync(playbookFile, toJSON(playbookSpec))
    const r1 = ospath.resolve(FIXTURES_DIR, 'custom-html5-converter.js')
    const args = ['--require', r1, 'generate', 'antora-playbook', '--quiet']
    return new Promise((resolve) => runAntora(args).on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(/<p>See <a href="the-page.html" class="xref page">the page<\/a>.<\/p>/)
        .and.with.contents.that.not.match(/<div class="paragraph">/)
    })
  })
})

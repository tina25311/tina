/* eslint-env mocha */
'use strict'

const EventEmitter = require('events')

const { deferExceptions, expect } = require('../../../test/test-utils')

const buildPlaybook = require('@antora/playbook-builder')
const ospath = require('path')

const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')

describe('buildPlaybook()', async () => {
  let schema, expectedPlaybook

  beforeEach(() => {
    schema = {
      playbook: {
        format: String,
        default: undefined,
        env: 'PLAYBOOK',
      },
      one: {
        one: {
          format: String,
          default: null,
          arg: 'one-one',
          env: 'ANTORA_ONE_ONE',
        },
        two: {
          format: String,
          default: 'default-value',
        },
        widget_key: {
          format: String,
          default: undefined,
          env: 'WIDGET_KEY',
        },
      },
      two: {
        format: Number,
        default: null,
        arg: 'two',
        env: 'ANTORA_TWO',
      },
      three: {
        format: Boolean,
        default: null,
        arg: 'three',
        env: 'ANTORA_THREE',
      },
      four: {
        format: Array,
        default: null,
      },
      keyvals: {
        format: 'map',
        default: {},
        arg: 'keyval',
        env: 'KEYVALS',
      },
      keyvals2: {
        format: String,
        default: undefined,
      },
    }

    expectedPlaybook = {
      one: {
        two: 'default-value',
        widgetKey: undefined,
      },
      two: 42,
      three: false,
      four: [
        { lastname: 'Lennon', name: 'John' },
        { lastname: 'McCartney', name: 'Paul' },
      ],
      keyvals: {},
      keyvals2: undefined,
    }
  })

  const ymlSpec = ospath.join(FIXTURES_DIR, 'spec-sample.yml')
  const yamlSpec = ospath.join(FIXTURES_DIR, 'spec-sample.yaml')
  const extensionlessSpec = ospath.join(FIXTURES_DIR, 'spec-sample')
  const extensionlessJsonSpec = ospath.join(FIXTURES_DIR, 'spec-sample-json')
  const extensionlessTomlSpec = ospath.join(FIXTURES_DIR, 'spec-sample-toml')
  const jsonSpec = ospath.join(FIXTURES_DIR, 'spec-sample.json')
  const tomlSpec = ospath.join(FIXTURES_DIR, 'spec-sample.toml')
  const iniSpec = ospath.join(FIXTURES_DIR, 'spec-sample.ini')
  const badSpec = ospath.join(FIXTURES_DIR, 'bad-spec-sample.yml')
  const coerceValueSpec = ospath.join(FIXTURES_DIR, 'coerce-value-spec-sample.yml')
  const invalidPrimitiveMapSpec = ospath.join(FIXTURES_DIR, 'invalid-primitive-map-spec-sample.yml')
  const invalidMapSpec = ospath.join(FIXTURES_DIR, 'invalid-map-spec-sample.yml')
  const nullMapSpec = ospath.join(FIXTURES_DIR, 'null-map-spec-sample.yml')
  const invalidDirOrFilesSpec = ospath.join(FIXTURES_DIR, 'invalid-dir-or-files-spec-sample.yml')
  const invalidStringOrBooleanSpec = ospath.join(FIXTURES_DIR, 'invalid-string-or-boolean-spec-sample.yml')
  const legacyGitEnsureGitSuffixSpec = ospath.join(FIXTURES_DIR, 'legacy-git-ensure-git-suffix-sample.yml')
  const legacyRuntimePullSpec = ospath.join(FIXTURES_DIR, 'legacy-runtime-pull-sample.yml')
  const legacyUiBundleSpec = ospath.join(FIXTURES_DIR, 'legacy-ui-bundle-sample.yml')
  const legacyUiStartPathSpec = ospath.join(FIXTURES_DIR, 'legacy-ui-start-path-sample.yml')
  const invalidSiteUrlSpec = ospath.join(FIXTURES_DIR, 'invalid-site-url-spec-sample.yml')
  const defaultSchemaSpec = ospath.join(FIXTURES_DIR, 'default-schema-spec-sample.yml')
  const defaultSchemaSpecWithPipelineExtension = ospath.join(FIXTURES_DIR, 'default-schema-spec-pipeline-extension-sample.yml')
  const defaultSchemaSpecWithPipelineExtensionConfigs = ospath.join(FIXTURES_DIR, 'default-schema-spec-pipeline-extension-config-sample.yml')

  it('should set dir to process.cwd() when playbook file is not specified', async () => {
    const playbook = await buildPlaybook([], {}, { playbook: { format: String, default: undefined } })
    expect(playbook.dir).to.equal(process.cwd())
    expect(playbook.file).to.not.exist()
  })

  it('should set dir and file properties based on absolute path of playbook file', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: ospath.relative('.', ymlSpec) }, schema)
    expect(playbook.dir).to.equal(ospath.dirname(ymlSpec))
    expect(playbook.file).to.equal(ymlSpec)
    expect(playbook.playbook).to.not.exist()
  })

  it('should load YAML playbook file with .yml extension', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)
    expectedPlaybook.dir = ospath.dirname(ymlSpec)
    expectedPlaybook.file = ymlSpec
    expectedPlaybook.one.one = 'yml-spec-value-one'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should load YAML playbook file with .yaml extension', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: yamlSpec }, schema)
    expectedPlaybook.dir = ospath.dirname(yamlSpec)
    expectedPlaybook.file = yamlSpec
    expectedPlaybook.one.one = 'yaml-spec-value-one'
    expectedPlaybook.four = [
      { lastname: 'Starr', name: 'Ringo' },
      { lastname: 'Harrison', name: 'George' },
    ]
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should load JSON (JSON 5) playbook file', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: jsonSpec }, schema)
    expectedPlaybook.dir = ospath.dirname(jsonSpec)
    expectedPlaybook.file = jsonSpec
    expectedPlaybook.one.one = 'json-spec-value-one'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should load TOML playbook file', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: tomlSpec }, schema)
    expectedPlaybook.dir = ospath.dirname(tomlSpec)
    expectedPlaybook.file = tomlSpec
    expectedPlaybook.one.one = 'toml-spec-value-one'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should load YAML playbook file first when no file extension is given', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: extensionlessSpec }, schema)
    expectedPlaybook.dir = ospath.dirname(extensionlessSpec)
    expectedPlaybook.file = extensionlessSpec + '.yml'
    expectedPlaybook.one.one = 'yml-spec-value-one'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should discover JSON playbook when no file extension is given', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: extensionlessJsonSpec }, schema)
    expectedPlaybook.dir = ospath.dirname(extensionlessJsonSpec)
    expectedPlaybook.file = extensionlessJsonSpec + '.json'
    expectedPlaybook.one.one = 'json-spec-value-one'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should discover TOML playbook when no file extension is given', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: extensionlessTomlSpec }, schema)
    expectedPlaybook.dir = ospath.dirname(extensionlessTomlSpec)
    expectedPlaybook.file = extensionlessTomlSpec + '.toml'
    expectedPlaybook.one.one = 'toml-spec-value-one'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should throw error when loading unknown type file', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: iniSpec }, schema)
    expect(buildPlaybookDeferred).to.throw('Unexpected playbook file type')
  })

  it('should throw error if specified playbook file does not exist', async () => {
    const expectedMessage =
      `playbook file not found at ${ospath.resolve('non-existent/file.yml')} ` +
      `(path: non-existent/file.yml, cwd: ${process.cwd()})`
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: 'non-existent/file.yml' }, schema)
    expect(buildPlaybookDeferred).to.throw(expectedMessage)
  })

  it('should not show details in error message if input path of playbook file matches resolved path', async () => {
    const playbookFilePath = ospath.resolve('non-existent/file.yml')
    const expectedMessage = `playbook file not found at ${playbookFilePath}`
    // FIXME: technically this does not assert that the details are absent
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: playbookFilePath }, schema)
    expect(buildPlaybookDeferred).to.throw(expectedMessage)
  })

  it('should not show cwd in error message if input path of playbook file is absolute', async () => {
    const playbookFilePath = ospath.resolve('non-existent/file.yml')
    const requestedPlaybookFilePath = [process.cwd(), 'non-existent', '..', 'non-existent/file.yml'].join(ospath.sep)
    const expectedMessage = `playbook file not found at ${playbookFilePath} (path: ${requestedPlaybookFilePath})`
    const buildPlaybookDeferred =
      await deferExceptions(buildPlaybook, [], { PLAYBOOK: requestedPlaybookFilePath }, schema)
    expect(buildPlaybookDeferred).to.throw(expectedMessage)
  })

  it('should throw error if playbook file without extension cannot be resolved', async () => {
    const resolvedRootPath = ospath.resolve('non-existent/file')
    const expectedMessage =
      'playbook file not found at ' +
      `${resolvedRootPath}.yml, ${resolvedRootPath}.json, or ${resolvedRootPath}.toml` +
      ` (path: non-existent/file, cwd: ${process.cwd()})`
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: 'non-existent/file' }, schema)
    expect(buildPlaybookDeferred).to.throw(expectedMessage)
  })

  it('should use default value if playbook file is not specified', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.one.two).to.equal('default-value')
  })

  it('should use env value over value in playbook file', async () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_ONE_ONE: 'the-env-value' }
    const playbook = await buildPlaybook([], env, schema)
    expect(playbook.one.one).to.equal('the-env-value')
  })

  it('should use env value over value in playbook file when env value is empty string', async () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_ONE_ONE: '' }
    const playbook = await buildPlaybook([], env, schema)
    expect(playbook.one.one).to.equal('')
  })

  it('should use args value over value in playbook file or env value even if value is falsy', async () => {
    const args = ['--one-one', 'the-args-value']
    const env = { PLAYBOOK: ymlSpec, ANTORA_ONE_ONE: 'the-env-value' }
    const playbook = await buildPlaybook(args, env, schema)
    expect(playbook.one.one).to.equal('the-args-value')
  })

  it('should use arg value over value in playbook file when arg value is falsy', async () => {
    const args = ['--two', '0']
    const env = { PLAYBOOK: ymlSpec, ANTORA_TWO: '47' }
    const playbook = await buildPlaybook(args, env, schema)
    expect(playbook.two).to.equal(0)
  })

  it('should convert properties of playbook to camelCase', async () => {
    const env = { PLAYBOOK: ymlSpec, WIDGET_KEY: 'xxxyyyzzz' }
    const playbook = await buildPlaybook([], env, schema)
    expect(playbook.one.widgetKey).to.equal('xxxyyyzzz')
  })

  it('should coerce Number values in playbook file', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.two).to.equal(42)
  })

  it('should coerce Number values in env', async () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_TWO: '777' }
    const playbook = await buildPlaybook([], env, schema)
    expect(playbook.two).to.equal(777)
  })

  it('should use env value over value in playbook file when env value is falsy', async () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_TWO: '0' }
    const playbook = await buildPlaybook([], env, schema)
    expect(playbook.two).to.equal(0)
  })

  it('should coerce Number values in args', async () => {
    const playbook = await buildPlaybook(['--two', '777'], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.two).to.equal(777)
  })

  it('should coerce Boolean values in playbook file', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.three).to.be.false()
  })

  it('should coerce Boolean values in env', async () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_THREE: 'true' }
    const playbook = await buildPlaybook([], env, schema)
    expect(playbook.three).to.be.true()
  })

  it('should coerce Boolean values in args', async () => {
    const playbook = await buildPlaybook(['--three'], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.three).to.be.true()
  })

  it('should coerce primitive map value in playbook file from Object', async () => {
    schema.keyvals.format = 'primitive-map'
    const playbook = await buildPlaybook([], { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.keyvals).to.eql({ key: 'val', keyOnly: '', foo: 'bar', nada: null, yep: true, nope: false })
  })

  it('should throw error if value of primitive map key is a String', async () => {
    schema.keyvals2.format = 'primitive-map'
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: coerceValueSpec }, schema)
    expect(buildPlaybookDeferred).to.throw(
      'must be a primitive map (i.e., key/value pairs, primitive values only)'
    )
  })

  it('should coerce primitive map value in env', async () => {
    schema.keyvals.format = 'primitive-map'
    const val = 'key=val,key-only,=valonly,empty=,tilde="~",site_tags="a,b,c",nada=~,y=true,n=false,when=2020-01-01'
    const env = { PLAYBOOK: ymlSpec, KEYVALS: val }
    const playbook = await buildPlaybook([], env, schema)
    expect(playbook.keyvals).to.eql({
      key: 'val',
      keyOnly: '',
      empty: '',
      tilde: '~',
      siteTags: 'a,b,c',
      nada: null,
      y: true,
      n: false,
      when: '2020-01-01',
    })
  })

  it('should coerce primitive map value in args', async () => {
    schema.keyvals.format = 'primitive-map'
    const playbook = await buildPlaybook(
      [
        '--keyval',
        'key=val',
        '--keyval',
        'key-only',
        '--keyval',
        '=valonly',
        '--keyval',
        'empty=',
        '--keyval',
        'tilde="~"',
        '--keyval',
        'site_tags="a,b,c"',
        '--keyval',
        'nada=~',
        '--keyval',
        'y=true',
        '--keyval',
        'n=false',
        '--keyval',
        'when=2020-01-01',
      ],
      { PLAYBOOK: ymlSpec },
      schema
    )
    expect(playbook.keyvals).to.eql({
      key: 'val',
      keyOnly: '',
      empty: '',
      tilde: '~',
      siteTags: 'a,b,c',
      nada: null,
      y: true,
      n: false,
      when: '2020-01-01',
    })
  })

  it('should use primitive map value in args to update map value from playbook file', async () => {
    schema.keyvals.format = 'primitive-map'
    const args = ['--keyval', 'foo=baz', '--keyval', 'key-only=useme']
    const playbook = await buildPlaybook(args, { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.keyvals.key).to.equal('val')
    expect(playbook.keyvals.keyOnly).to.equal('useme')
    expect(playbook.keyvals.foo).to.equal('baz')
  })

  it('should throw error if value of primitive map key is not an object', async () => {
    schema.keyvals.format = 'primitive-map'
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: invalidMapSpec }, schema)
    expect(buildPlaybookDeferred).to.throw(
      'must be a primitive map (i.e., key/value pairs, primitive values only)'
    )
  })

  it('should throw error if value of primitive map key is not primitive', async () => {
    schema.keyvals.format = 'primitive-map'
    const buildPlaybookDeferred =
      await deferExceptions(buildPlaybook, [], { PLAYBOOK: invalidPrimitiveMapSpec }, schema)
    expect(buildPlaybookDeferred).to.throw(
      'must be a primitive map (i.e., key/value pairs, primitive values only)'
    )
  })

  it('should allow value of primitive map key to be null', async () => {
    schema.keyvals.format = 'primitive-map'
    const playbook = await buildPlaybook([], { PLAYBOOK: nullMapSpec }, schema)
    expect(playbook.keyvals).to.be.null()
  })

  it('should coerce map value in playbook file from Object', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.keyvals).to.eql({ key: 'val', keyOnly: '', foo: 'bar', nada: null, yep: true, nope: false })
  })

  it('should throw error if value of map key is a String', async () => {
    schema.keyvals2.format = 'map'
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: coerceValueSpec }, schema)
    expect(buildPlaybookDeferred).to.throw(
      'must be a map (i.e., key/value pairs)'
    )
  })

  it('should coerce map value in env', async () => {
    const val = 'key=val,key-only,=valonly,empty=,tilde="~",site_tags="a,b,c",nada=~,y=true,n=false'
    const env = { PLAYBOOK: ymlSpec, KEYVALS: val }
    const playbook = await buildPlaybook([], env, schema)
    expect(playbook.keyvals).to.eql({
      key: 'val',
      keyOnly: '',
      empty: '',
      tilde: '~',
      siteTags: 'a,b,c',
      nada: null,
      y: true,
      n: false,
    })
  })

  it('should coerce map value in args', async () => {
    const playbook = await buildPlaybook(
      [
        '--keyval',
        'key=val',
        '--keyval',
        'key-only',
        '--keyval',
        '=valonly',
        '--keyval',
        'empty=',
        '--keyval',
        'tilde="~"',
        '--keyval',
        'site_tags="a,b,c"',
        '--keyval',
        'nada=~',
        '--keyval',
        'y=true',
        '--keyval',
        'n=false',
      ],
      { PLAYBOOK: ymlSpec },
      schema
    )
    expect(playbook.keyvals).to.eql({
      key: 'val',
      keyOnly: '',
      empty: '',
      tilde: '~',
      siteTags: 'a,b,c',
      nada: null,
      y: true,
      n: false,
    })
  })

  it('should use map value in args to update map value from playbook file', async () => {
    const playbook = await buildPlaybook(['--keyval', 'foo=baz'], { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.keyvals.key).to.equal('val')
    expect(playbook.keyvals.foo).to.equal('baz')
  })

  it('should update map value from playbook file with map values in args when name is asciidoc.attributes', async () => {
    const args = ['--playbook', defaultSchemaSpec, '--attribute', 'idprefix=user-', '--attribute', 'idseparator=-']
    const playbook = await buildPlaybook(args, {})
    expect(playbook.asciidoc.attributes).to.eql({
      'allow-uri-read': true,
      idprefix: 'user-',
      idseparator: '-',
      toc: false,
      'uri-project': 'https://antora.org',
    })
  })

  it('should throw error if value of map key is not an object', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: invalidMapSpec }, schema)
    expect(buildPlaybookDeferred).to.throw('must be a map (i.e., key/value pairs)')
  })

  it('should allow value of map key to be null', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: nullMapSpec }, schema)
    expect(playbook.keyvals).to.be.null()
  })

  it('should coerce String value to Array', async () => {
    const playbook = await buildPlaybook([], { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.file).to.equal(coerceValueSpec)
    expect(playbook.dir).to.equal(ospath.dirname(coerceValueSpec))
    expect(playbook.one.one).to.equal('one')
    expect(playbook.four).to.eql(['John'])
  })

  it('should throw error if dir-or-virtual-files key is not a string or array', async () => {
    Object.keys(schema).forEach((key) => {
      if (key !== 'playbook') delete schema[key]
    })
    schema.files = {
      format: 'dir-or-virtual-files',
      default: undefined,
    }
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: invalidDirOrFilesSpec }, schema)
    expect(buildPlaybookDeferred).to.throw(
      'must be a directory path or list of virtual files'
    )
  })

  it('should throw error when trying to load values not declared in the schema', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: badSpec }, schema)
    expect(buildPlaybookDeferred).to.throw('not declared')
  })

  it('should throw error when playbook file uses values of the wrong format', async () => {
    schema.two.format = String
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, [], { PLAYBOOK: ymlSpec }, schema)
    expect(buildPlaybookDeferred).to.throw('must be of type String')
  })

  it('should return an immutable playbook', async () => {
    const playbook = buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)
    expect(() => {
      playbook.one.two = 'override'
    }).to.throw()
  })

  it('should use default schema if no schema is specified', async () => {
    const playbook = await buildPlaybook(['--playbook', defaultSchemaSpec], {})
    expect(playbook.runtime.cacheDir).to.equal('./.antora-cache')
    expect(playbook.runtime.fetch).to.equal(true)
    expect(playbook.runtime.quiet).to.equal(false)
    expect(playbook.runtime.silent).to.equal(false)
    expect(playbook.site.url).to.equal('https://example.com')
    expect(playbook.site.title).to.equal('Example site')
    expect(playbook.site.startPage).to.equal('1.0@server::intro')
    expect(playbook.site.keys.googleAnalytics).to.equal('XX-123456')
    expect(playbook.site.keys.jiraCollectorId).to.equal('xyz123')
    expect(playbook.content.branches).to.eql(['v*'])
    expect(playbook.content.editUrl).to.equal('{web_url}/blob/{refname}/{path}')
    expect(playbook.content.sources).to.have.lengthOf(1)
    expect(playbook.content.sources[0]).to.eql({
      url: 'https://gitlab.com/antora/demo/demo-component-a.git',
      branches: ['master', 'v*'],
    })
    expect(playbook.ui.bundle.url).to.equal('./../ui/build/ui-bundles.zip')
    expect(playbook.ui.bundle.startPath).to.equal('dark-theme')
    expect(playbook.ui.outputDir).to.equal('_')
    expect(playbook.ui.defaultLayout).to.equal('default')
    expect(playbook.ui.supplementalFiles).to.have.lengthOf(1)
    expect(playbook.ui.supplementalFiles[0]).to.eql({
      path: 'head-meta.hbs',
      contents: '<link rel="stylesheet" href="https://example.org/shared.css">',
    })
    expect(playbook.asciidoc.attributes).to.eql({
      'allow-uri-read': true,
      idprefix: '',
      toc: false,
      'uri-project': 'https://antora.org',
    })
    expect(playbook.asciidoc.extensions).to.eql(['asciidoctor-plantuml', './lib/shout-block'])
    expect(playbook.git.credentials.path).to.equal('./.git-credentials')
    expect(playbook.git.ensureGitSuffix).to.equal(true)
    expect(playbook.urls.htmlExtensionStyle).to.equal('indexify')
    expect(playbook.urls.redirectFacility).to.equal('nginx')
    expect(playbook.urls.latestVersionSegmentStrategy).to.equal('redirect:to')
    expect(playbook.urls.latestVersionSegment).to.equal('stable')
    expect(playbook.urls.latestPrereleaseVersionSegment).to.equal('unstable')
    expect(playbook.output.destinations).to.have.lengthOf(1)
    expect(playbook.output.dir).to.equal('./_site')
    expect(playbook.output.destinations[0].provider).to.equal('archive')
    expect(playbook.output.destinations[0].path).to.equal('./site.zip')
  })

  it('should allow site.url to be a pathname', async () => {
    const playbook = await buildPlaybook(['--playbook', defaultSchemaSpec, '--url', '/docs'], {})
    expect(playbook.site.url).to.equal('/docs')
  })

  it('should throw error if site.url is a relative path', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, ['--playbook', defaultSchemaSpec, '--url', 'docs'], {})
    expect(buildPlaybookDeferred).to.throw(
      'must be an absolute URL or a pathname (i.e., root-relative path)'
    )
  })

  it('should throw error if site.url is a file URI', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, ['--playbook', defaultSchemaSpec, '--url', 'file:///path/to/docs'], {})
    expect(buildPlaybookDeferred).to.throw(
      'must be an absolute URL or a pathname (i.e., root-relative path)'
    )
  })

  it('should throw error if site.url is an invalid URL', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, ['--playbook', defaultSchemaSpec, '--url', ':/foo'], {})
    expect(buildPlaybookDeferred).to.throw(
      'must be an absolute URL or a pathname (i.e., root-relative path)'
    )
  })

  it('should throw error if site.url is not a string', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, ['--playbook', invalidSiteUrlSpec], {})
    expect(buildPlaybookDeferred).to.throw(
      'must be an absolute URL or a pathname (i.e., root-relative path)'
    )
  })

  it('should throw error if site.url is a pathname containing spaces', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, ['--playbook', defaultSchemaSpec, '--url', '/my docs'], {})
    expect(buildPlaybookDeferred).to.throw(
      'must not contain spaces'
    )
  })

  it('should throw error if site.url is an absolute URL containing spaces in the pathname', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook, ['--playbook', defaultSchemaSpec, '--url', 'https://example.org/my docs'], {})
    expect(buildPlaybookDeferred).to.throw(
      'must not contain spaces'
    )
  })

  it('should throw error if boolean-or-string key is not a boolean or string', async () => {
    Object.keys(schema).forEach((key) => {
      if (key !== 'playbook') delete schema[key]
    })
    schema.edit_url = {
      format: 'boolean-or-string',
      default: undefined,
    }
    const buildPlaybookDeferred =
      await deferExceptions(buildPlaybook, [], { PLAYBOOK: invalidStringOrBooleanSpec }, schema)
    expect(buildPlaybookDeferred).to.throw(
      'must be a boolean or string'
    )
  })

  it('should not accept playbook data that defines git.ensureGitSuffix', async () => {
    expect(await deferExceptions(buildPlaybook, ['--playbook', legacyGitEnsureGitSuffixSpec], {})).to.throw(/not declared in the schema/)
  })

  it('should not accept playbook data that defines runtime.pull', async () => {
    expect(await deferExceptions(buildPlaybook, ['--playbook', legacyRuntimePullSpec], {})).to.throw(/not declared in the schema/)
  })

  it('should not accept playbook data that defines ui.bundle as a String', async () => {
    expect(await deferExceptions(buildPlaybook, ['--playbook', legacyUiBundleSpec], {})).to.throw(/not declared in the schema/)
  })

  it('should not accept playbook data that defines ui.start_path', async () => {
    expect(await deferExceptions(buildPlaybook, ['--playbook', legacyUiStartPathSpec], {})).to.throw(/not declared in the schema/)
  })

  it('should throw if no configuration data is given', async () => {
    const buildPlaybookDeferred = await deferExceptions(buildPlaybook)
    expect(buildPlaybookDeferred).to.throw()
  })

  it('should be decoupled from the process environment', async () => {
    const originalEnv = process.env
    process.env = { URL: 'https://docs.example.org' }
    const playbook = await buildPlaybook(['--ui-bundle-url', 'ui-bundle.zip'])
    expect(playbook.site.url).to.be.undefined()
    process.env = originalEnv
  })

  it('should leave the process environment unchanged', async () => {
    const processArgv = process.argv
    const processEnv = process.env
    const args = ['--one-one', 'the-args-value']
    const env = { PLAYBOOK: ymlSpec, ANTORA_TWO: 99 }
    const playbook = await buildPlaybook(args, env, schema)
    expect(playbook.one.one).to.equal('the-args-value')
    expect(playbook.two).to.equal(99)
    expect(playbook.three).to.equal(false)
    expect(process.argv).to.equal(processArgv)
    expect(process.env).to.equal(processEnv)
  })

  describe('build playbook with pipeline extensions', async () => {
    let eventEmitter, eventContext

    beforeEach(() => {
      const baseEmitter = new EventEmitter()

      eventEmitter = {

        emit: async (name, ...args) => {
          const promises = []
          baseEmitter.emit(name, promises, ...args)
          promises.length && await Promise.all(promises)
        },

        on: (name, listener) => baseEmitter.on(name, (promises, ...args) => promises.push(listener(...args))),
      }

      eventContext = {}
    })
    it('should accept empty default pipeline extensions supplied', async () => {
      await buildPlaybook(['--playbook', defaultSchemaSpec], {}, undefined,
        eventEmitter, eventContext, [])
    })

    it('should accept default pipeline extensions supplied', async () => {
      const eventContext = {}
      const plugin = {
        eventContext,

        register: (eventEmitter) => {
          eventEmitter.on('beforeBuildPlaybook', ({ args, env, schema }) => {
            eventContext.before = 'called'
          })
          eventEmitter.on('afterBuildPlaybook', (playbook) => {
            eventContext.after = 'called'
          })
        },
      }
      await buildPlaybook(['--playbook', defaultSchemaSpec], {}, undefined,
        eventEmitter, [plugin])
      expect(eventContext.before).to.equal('called')
      expect(eventContext.after).to.equal('called')
    })

    it('default pipeline extension should be able to modify args', async () => {
      const eventContext = {}
      const plugin = {
        eventContext,

        register: (eventEmitter) => {
          eventEmitter.on('beforeBuildPlaybook', ({ args, env, schema }) => {
            eventContext.before = 'called'
            args.push('--attribute')
            args.push('foo=bar')
          })
          eventEmitter.on('afterBuildPlaybook', (playbook) => {
            eventContext.after = 'called'
          })
        },
      }
      const env = {}
      const playbook = await buildPlaybook(['--playbook', defaultSchemaSpec], env, undefined,
        eventEmitter, [plugin])
      expect(eventContext.before).to.equal('called')
      expect(eventContext.after).to.equal('called')
      expect(playbook.asciidoc.attributes.foo).to.equal('bar')
    })

    it('default pipeline extension should be able to modify playbook', async () => {
      const eventContext = {}
      const plugin = {
        eventContext,

        register: (eventEmitter) => {
          eventEmitter.on('beforeBuildPlaybook', ({ args, env, schema }) => {
            eventContext.before = 'called'
          })
          eventEmitter.on('afterBuildPlaybook', (playbook) => {
            eventContext.after = 'called'
            playbook.extra = ['foo', 'bar']
          })
        },
      }
      const env = {}
      const playbook = await buildPlaybook(['--playbook', defaultSchemaSpec], env, undefined,
        eventEmitter, [plugin])
      expect(eventContext.before).to.equal('called')
      expect(eventContext.after).to.equal('called')
      expect(playbook.extra.length).to.equal(2)
      expect(playbook.extra[0]).to.equal('foo')
      expect(playbook.extra[1]).to.equal('bar')
    })

    it('should accept pipeline extensions specified in playbook', async () => {
      const env = {}
      const playbook = await buildPlaybook(['--playbook', defaultSchemaSpecWithPipelineExtension], env, undefined,
        eventEmitter)
      expect(env.beforeLoaded).to.equal(undefined)
      expect(playbook.afterLoaded).to.equal('called')
    })

    it('should accept pipeline extensions via cli', async () => {
      const env = {}
      const playbook = await buildPlaybook(['--playbook', defaultSchemaSpec, '--pipeline-extension', './pipeline-extensions/test-extension.js'], env, undefined,
        eventEmitter)
      expect(env.beforeLoaded).to.equal(undefined)
      expect(playbook.afterLoaded).to.equal('called')
    })

    it('should accept pipeline extensions added to playbook by default pipeline extension', async () => {
      const eventContext = {}
      const extension = {
        eventContext,

        register: (eventEmitter) => {
          eventEmitter.on('beforeBuildPlaybook', ({ args, env, schema }) => {
            eventContext.before = 'called'
            args.push('--pipeline-extension')
            args.push('./pipeline-extensions/test-extension.js')
          })
          eventEmitter.on('afterBuildPlaybook', (playbook) => {
            eventContext.after = 'called'
          })
        },
      }
      const env = {}
      const playbook = await buildPlaybook(['--playbook', defaultSchemaSpec], env, undefined,
        eventEmitter, [extension])
      expect(eventContext.before).to.equal('called')
      expect(eventContext.after).to.equal('called')
      expect(env.beforeLoaded).to.equal(undefined)
      expect(playbook.afterLoaded).to.equal('called')
    })

    it('should accept pipeline extensions specified in playbook with config', async () => {
      const env = {}
      const playbook = await buildPlaybook(['--playbook', defaultSchemaSpecWithPipelineExtensionConfigs], env, undefined,
        eventEmitter)
      expect(env.beforeLoaded).to.equal(undefined)
      expect(playbook.afterLoaded).to.equal('called')
      const configs = playbook.configs
      expect(configs.length).to.equal(2)
      const config1 = configs[0]
      expect(config1).to.deep.equal({ param1: 'foo', param2: 'bar' })
      const config2 = configs[1]
      expect(config2).to.deep.equal({ param3: 'foo', param4: { subparam1: 3, arrayparam: ['foo', 'bar'] } })
    })
  })
})

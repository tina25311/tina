/* eslint-env mocha */
'use strict'

const { expect } = require('@antora/test-harness')

const buildPlaybook = require('@antora/playbook-builder')
const ospath = require('path')

const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')

describe('buildPlaybook()', () => {
  let schema, expectedPlaybook

  beforeEach(() => {
    schema = {
      playbook: {
        format: String,
        default: undefined,
        env: 'PLAYBOOK',
      },
      ext: {
        format: String,
        default: undefined,
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
  const invalidTypeTagSpec = ospath.join(FIXTURES_DIR, 'invalid-type-tag-spec-sample.yml')
  const invalidMapSpec = ospath.join(FIXTURES_DIR, 'invalid-map-spec-sample.yml')
  const nullMapSpec = ospath.join(FIXTURES_DIR, 'null-map-spec-sample.yml')
  const invalidDirOrFilesSpec = ospath.join(FIXTURES_DIR, 'invalid-dir-or-files-spec-sample.yml')
  const invalidStringOrBooleanSpec = ospath.join(FIXTURES_DIR, 'invalid-string-or-boolean-spec-sample.yml')
  const invalidDuplicateKeySpec = ospath.join(FIXTURES_DIR, 'invalid-duplicate-key-spec-sample.yml')
  const preserveAllKeysSpec = ospath.join(FIXTURES_DIR, 'preserve-all-keys-spec-sample.yml')
  const preserveSpecifiedKeysSpec = ospath.join(FIXTURES_DIR, 'preserve-specified-keys-spec-sample.yml')
  const runtimeLogFormatSpec = ospath.join(FIXTURES_DIR, 'runtime-log-format-spec-sample.yml')
  const legacyGitEnsureGitSuffixSpec = ospath.join(FIXTURES_DIR, 'legacy-git-ensure-git-suffix-sample.yml')
  const legacyRuntimePullSpec = ospath.join(FIXTURES_DIR, 'legacy-runtime-pull-sample.yml')
  const legacyUiBundleSpec = ospath.join(FIXTURES_DIR, 'legacy-ui-bundle-sample.yml')
  const legacyUiStartPathSpec = ospath.join(FIXTURES_DIR, 'legacy-ui-start-path-sample.yml')
  const invalidSiteUrlSpec = ospath.join(FIXTURES_DIR, 'invalid-site-url-spec-sample.yml')
  const contentSourceVersionSpec = ospath.join(FIXTURES_DIR, 'content-source-version-spec-sample.yml')
  const contentSourceMergeSpec = ospath.join(FIXTURES_DIR, 'content-source-merge-spec-sample.yml')
  const defaultSchemaSpec = ospath.join(FIXTURES_DIR, 'default-schema-spec-sample.yml')

  it('should set dir to process.cwd() when playbook file is not specified', () => {
    const playbook = buildPlaybook([], {}, { playbook: { format: String, default: undefined } })
    expect(playbook.dir).to.equal(process.cwd())
    expect(playbook.file).to.not.exist()
  })

  it('should set dir and file properties based on absolute path of playbook file', () => {
    const playbook = buildPlaybook([], { PLAYBOOK: ospath.relative('.', ymlSpec) }, schema)
    expect(playbook.dir).to.equal(ospath.dirname(ymlSpec))
    expect(playbook.file).to.equal(ymlSpec)
    expect(playbook.playbook).to.not.exist()
  })

  it('should set env property to process.env if second positional parameter is undefined', () => {
    const oldEnv = process.env
    try {
      process.env = Object.assign({}, oldEnv)
      process.env.FOOBAR = 'baz'
      const playbook = buildPlaybook([], undefined, { foobar: { format: String, default: undefined, env: 'FOOBAR' } })
      expect(playbook.foobar).to.equal('baz')
      expect(playbook.env).to.equal(process.env)
      process.env.TMP_ENV_VAR = 'value'
      expect(playbook.env.TMP_ENV_VAR).to.equal('value')
      expect(Object.keys(playbook)).to.include('env')
    } finally {
      process.env = oldEnv
    }
  })

  it('should set env property to empty object if second positional argument is empty object', () => {
    const playbook = buildPlaybook([], {}, { playbook: { format: String, default: undefined } })
    expect(playbook.env).to.eql({})
    expect(Object.isFrozen(playbook.env)).to.be.false()
  })

  it('should load YAML playbook file with .yml extension', () => {
    const env = { PLAYBOOK: ymlSpec }
    const playbook = buildPlaybook([], env, schema)
    expectedPlaybook.env = env
    expectedPlaybook.dir = ospath.dirname(ymlSpec)
    expectedPlaybook.file = ymlSpec
    expectedPlaybook.ext = '.yml'
    expectedPlaybook.one.one = '1'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should load YAML playbook file with .yaml extension', () => {
    const env = { PLAYBOOK: yamlSpec }
    const playbook = buildPlaybook([], env, schema)
    expectedPlaybook.env = env
    expectedPlaybook.dir = ospath.dirname(yamlSpec)
    expectedPlaybook.file = yamlSpec
    expectedPlaybook.ext = '.yaml'
    expectedPlaybook.one.one = '1'
    expectedPlaybook.four = [
      { lastname: 'Starr', name: 'Ringo' },
      { lastname: 'Harrison', name: 'George' },
    ]
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should load JSON (JSON 5) playbook file', () => {
    const env = { PLAYBOOK: jsonSpec }
    const playbook = buildPlaybook([], env, schema)
    expectedPlaybook.env = env
    expectedPlaybook.dir = ospath.dirname(jsonSpec)
    expectedPlaybook.file = jsonSpec
    expectedPlaybook.ext = '.json'
    expectedPlaybook.one.one = '1'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should load TOML playbook file', () => {
    const env = { PLAYBOOK: tomlSpec }
    const playbook = buildPlaybook([], env, schema)
    expectedPlaybook.env = env
    expectedPlaybook.dir = ospath.dirname(tomlSpec)
    expectedPlaybook.file = tomlSpec
    expectedPlaybook.ext = '.toml'
    expectedPlaybook.one.one = '1'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should load YAML playbook file first when no file extension is given', () => {
    const env = { PLAYBOOK: extensionlessSpec }
    const playbook = buildPlaybook([], env, schema)
    expectedPlaybook.env = env
    expectedPlaybook.dir = ospath.dirname(extensionlessSpec)
    expectedPlaybook.file = extensionlessSpec + '.yml'
    expectedPlaybook.ext = '.yml'
    expectedPlaybook.one.one = '1'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should discover JSON playbook when no file extension is given', () => {
    const env = { PLAYBOOK: extensionlessJsonSpec }
    const playbook = buildPlaybook([], env, schema)
    expectedPlaybook.env = env
    expectedPlaybook.dir = ospath.dirname(extensionlessJsonSpec)
    expectedPlaybook.file = extensionlessJsonSpec + '.json'
    expectedPlaybook.ext = '.json'
    expectedPlaybook.one.one = '1'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should discover TOML playbook when no file extension is given', () => {
    const env = { PLAYBOOK: extensionlessTomlSpec }
    const playbook = buildPlaybook([], env, schema)
    expectedPlaybook.env = env
    expectedPlaybook.dir = ospath.dirname(extensionlessTomlSpec)
    expectedPlaybook.file = extensionlessTomlSpec + '.toml'
    expectedPlaybook.ext = '.toml'
    expectedPlaybook.one.one = '1'
    expect(playbook).to.eql(expectedPlaybook)
  })

  it('should throw error when loading file with unknown extension', () => {
    const expected = 'Unknown playbook file extension: must be .yml (or .yaml), .json, or .toml'
    expect(() => buildPlaybook([], { PLAYBOOK: iniSpec }, schema)).to.throw(expected)
  })

  it('should throw error if specified playbook file does not exist', () => {
    const expectedMessage =
      `playbook file not found at ${ospath.resolve('nonexistent/file.yml')} ` +
      `(cwd: ${process.cwd()}, playbook: nonexistent/file.yml)`
    expect(() => buildPlaybook([], { PLAYBOOK: 'nonexistent/file.yml' }, schema)).to.throw(expectedMessage)
  })

  it('should not show details in error message if specified playbook file matches resolved path', () => {
    const playbookFilePath = ospath.resolve('nonexistent/file.yml')
    const unexpectedMessage = `playbook file not found at ${playbookFilePath} (`
    const expectedMessage = `playbook file not found at ${playbookFilePath}`
    expect(() => buildPlaybook([], { PLAYBOOK: playbookFilePath }, schema)).to.not.throw(unexpectedMessage)
    expect(() => buildPlaybook([], { PLAYBOOK: playbookFilePath }, schema)).to.throw(expectedMessage)
  })

  it('should not show cwd in error message if specified playbook file does not match resolved path and is absolute', () => {
    const playbookFilePath = ospath.resolve('nonexistent/file.yml')
    const requestedPlaybookFilePath = [process.cwd(), 'nonexistent', '..', 'nonexistent/file.yml'].join(ospath.sep)
    const expectedMessage = `playbook file not found at ${playbookFilePath} (playbook: ${requestedPlaybookFilePath})`
    expect(() => buildPlaybook([], { PLAYBOOK: requestedPlaybookFilePath }, schema)).to.throw(expectedMessage)
  })

  it('should throw error if playbook file without extension cannot be resolved', () => {
    const resolvedRootPath = ospath.resolve('nonexistent/file')
    const expectedMessage =
      'playbook file not found at ' +
      `${resolvedRootPath}.yml, ${resolvedRootPath}.json, or ${resolvedRootPath}.toml` +
      ` (cwd: ${process.cwd()}, playbook: nonexistent/file)`
    expect(() => buildPlaybook([], { PLAYBOOK: 'nonexistent/file' }, schema)).to.throw(expectedMessage)
  })

  it('should not freeze properties playbook object', () => {
    const env = { PLAYBOOK: ymlSpec }
    schema.category = { env: { format: String, default: 'not the env' } }
    const playbook = buildPlaybook([], env, schema)
    expect(Object.isFrozen(playbook)).to.be.false()
  })

  it('should use default value if playbook file is not specified', () => {
    schema = Object.assign({}, schema, { playbook: { format: String, default: ymlSpec } })
    const playbook = buildPlaybook([], {}, schema)
    expect(playbook.one.two).to.equal('default-value')
  })

  it('should use env value over value in playbook file', () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_ONE_ONE: 'the-env-value' }
    const playbook = buildPlaybook([], env, schema)
    expect(playbook.one.one).to.equal('the-env-value')
  })

  it('should use env value over value in playbook file when env value is empty string', () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_ONE_ONE: '' }
    const playbook = buildPlaybook([], env, schema)
    expect(playbook.one.one).to.equal('')
  })

  it('should use args value over value in playbook file or env value even if value is falsy', () => {
    const args = ['--one-one', 'the-args-value']
    const env = { PLAYBOOK: ymlSpec, ANTORA_ONE_ONE: 'the-env-value' }
    const playbook = buildPlaybook(args, env, schema)
    expect(playbook.one.one).to.equal('the-args-value')
  })

  it('should use arg value over value in playbook file when arg value is falsy', () => {
    const args = ['--two', '0']
    const env = { PLAYBOOK: ymlSpec, ANTORA_TWO: '47' }
    const playbook = buildPlaybook(args, env, schema)
    expect(playbook.two).to.equal(0)
  })

  it('should convert properties of playbook to camelCase', () => {
    const env = { PLAYBOOK: ymlSpec, WIDGET_KEY: 'xxxyyyzzz' }
    const playbook = buildPlaybook([], env, schema)
    expect(playbook.one.widgetKey).to.equal('xxxyyyzzz')
  })

  it('should coerce Number values in playbook file', () => {
    const playbook = buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.two).to.equal(42)
  })

  it('should coerce Number values in env', () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_TWO: '777' }
    const playbook = buildPlaybook([], env, schema)
    expect(playbook.two).to.equal(777)
  })

  it('should use env value over value in playbook file when env value is falsy', () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_TWO: '0' }
    const playbook = buildPlaybook([], env, schema)
    expect(playbook.two).to.equal(0)
  })

  it('should coerce Number values in args', () => {
    const playbook = buildPlaybook(['--two', '777'], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.two).to.equal(777)
  })

  it('should coerce Boolean values in playbook file', () => {
    const playbook = buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.three).to.be.false()
  })

  it('should coerce Boolean values in env', () => {
    const env = { PLAYBOOK: ymlSpec, ANTORA_THREE: 'TRUE' }
    const playbook = buildPlaybook([], env, schema)
    expect(playbook.three).to.be.true()
  })

  it('should coerce Boolean values in args', () => {
    const playbook = buildPlaybook(['--three'], { PLAYBOOK: ymlSpec }, schema)
    expect(playbook.three).to.be.true()
  })

  it('should coerce primitive map value in playbook file from Object', () => {
    schema.keyvals.format = 'primitive-map'
    const playbook = buildPlaybook([], { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.keyvals).to.eql({ key: 'val', keyOnly: '', foo: 'bar', nada: null, yep: true, nope: false })
  })

  it('should throw error if value of primitive map key is a String', () => {
    schema.keyvals2.format = 'primitive-map'
    expect(() => buildPlaybook([], { PLAYBOOK: coerceValueSpec }, schema)).to.throw(
      'must be a primitive map (i.e., key/value pairs, primitive values only)'
    )
  })

  it('should coerce primitive map value in env', () => {
    schema.keyvals.format = 'primitive-map'
    const val = 'key=val,key-only,=val,empty=,tilde="~",the_tags="a,b,c",_s-lvl=0,nada=~,y=true,n=false,when=2020-01-01'
    const env = { PLAYBOOK: ymlSpec, KEYVALS: val }
    const playbook = buildPlaybook([], env, schema)
    expect(playbook.keyvals).to.eql({
      key: 'val',
      keyOnly: '',
      empty: '',
      tilde: '~',
      theTags: 'a,b,c',
      sLvl: 0,
      nada: null,
      y: true,
      n: false,
      when: '2020-01-01',
    })
  })

  it('should coerce primitive map value in args', () => {
    schema.keyvals.format = 'primitive-map'
    const playbook = buildPlaybook(
      [
        '--keyval',
        'key=val',
        '--keyval',
        'key-only',
        '--keyval',
        '=val',
        '--keyval',
        'empty=',
        '--keyval',
        'tilde="~"',
        '--keyval',
        'the_tags="a,b,c"',
        '--keyval',
        '_s-lvl=0',
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
      theTags: 'a,b,c',
      sLvl: 0,
      nada: null,
      y: true,
      n: false,
      when: '2020-01-01',
    })
  })

  it('should use primitive map value in args to update map value from playbook file', () => {
    schema.keyvals.format = 'primitive-map'
    const args = ['--keyval', 'foo=baz', '--keyval', 'key-only=useme']
    const playbook = buildPlaybook(args, { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.keyvals.key).to.equal('val')
    expect(playbook.keyvals.keyOnly).to.equal('useme')
    expect(playbook.keyvals.foo).to.equal('baz')
  })

  it('should throw error if value of primitive map key is not an object', () => {
    schema.keyvals.format = 'primitive-map'
    expect(() => buildPlaybook([], { PLAYBOOK: invalidMapSpec }, schema)).to.throw(
      'must be a primitive map (i.e., key/value pairs, primitive values only)'
    )
  })

  it('should throw error if value of primitive map key is not primitive', () => {
    schema.keyvals.format = 'primitive-map'
    expect(() => buildPlaybook([], { PLAYBOOK: invalidPrimitiveMapSpec }, schema)).to.throw(
      'must be a primitive map (i.e., key/value pairs, primitive values only)'
    )
  })

  it('should allow value of primitive map key to be null', () => {
    schema.keyvals.format = 'primitive-map'
    const playbook = buildPlaybook([], { PLAYBOOK: nullMapSpec }, schema)
    expect(playbook.keyvals).to.be.null()
  })

  it('should coerce map value in playbook file from Object', () => {
    const playbook = buildPlaybook([], { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.keyvals).to.eql({ key: 'val', keyOnly: '', foo: 'bar', nada: null, yep: true, nope: false })
  })

  it('should throw error if value of map key is a String', () => {
    schema.keyvals2.format = 'map'
    expect(() => buildPlaybook([], { PLAYBOOK: coerceValueSpec }, schema)).to.throw(
      'must be a map (i.e., key/value pairs)'
    )
  })

  it('should coerce map value in env', () => {
    const val = 'key=val,key_only,=valonly,empty=,tilde="~",site_tags="a,b,c",foo-bar=baz,nada=~,y=true,n=false'
    const env = { PLAYBOOK: ymlSpec, KEYVALS: val }
    const playbook = buildPlaybook([], env, schema)
    expect(playbook.keyvals).to.eql({
      key: 'val',
      keyOnly: '',
      empty: '',
      tilde: '~',
      siteTags: 'a,b,c',
      fooBar: 'baz',
      nada: null,
      y: true,
      n: false,
    })
  })

  it('should coerce map value in args', () => {
    const playbook = buildPlaybook(
      [
        '--keyval',
        'key=val',
        '--keyval',
        'key_only',
        '--keyval',
        '=valonly',
        '--keyval',
        'empty=',
        '--keyval',
        'tilde="~"',
        '--keyval',
        'site_tags="a,b,c"',
        '--keyval',
        'foo-bar=baz',
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
      fooBar: 'baz',
      nada: null,
      y: true,
      n: false,
    })
  })

  it('should use map value in args to update map value from playbook file', () => {
    const playbook = buildPlaybook(['--keyval', 'foo=baz'], { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.keyvals.key).to.equal('val')
    expect(playbook.keyvals.foo).to.equal('baz')
  })

  it('should update map value from playbook file with map values in args when name is asciidoc.attributes', () => {
    const args = [
      '--playbook',
      defaultSchemaSpec,
      '--attribute',
      'idprefix=user-',
      '--attribute',
      'idseparator=-',
      '--attribute',
      "aq='",
      '--attribute',
      'reproducible',
    ]
    const playbook = buildPlaybook(args, {})
    expect(playbook.asciidoc.attributes).to.eql({
      'allow-uri-read': true,
      idprefix: 'user-',
      idseparator: '-',
      toc: false,
      reproducible: '',
      aq: "'",
      'uri-project': 'https://antora.org',
    })
  })

  it('should throw error if value of map key is not an object', () => {
    expect(() => buildPlaybook([], { PLAYBOOK: invalidMapSpec }, schema)).to.throw(
      'must be a map (i.e., key/value pairs)'
    )
  })

  it('should allow value of map key to be null', () => {
    const playbook = buildPlaybook([], { PLAYBOOK: nullMapSpec }, schema)
    expect(playbook.keyvals).to.be.null()
  })

  it('should coerce String value to Array', () => {
    const playbook = buildPlaybook([], { PLAYBOOK: coerceValueSpec }, schema)
    expect(playbook.file).to.equal(coerceValueSpec)
    expect(playbook.dir).to.equal(ospath.dirname(coerceValueSpec))
    expect(playbook.one.one).to.equal('one')
    expect(playbook.four).to.eql(['John'])
  })

  it('should add entries to value of require-array type from playbook file with values in args', () => {
    const args = ['--playbook', defaultSchemaSpec, '--extension', './lib/add-nojekyll.js', '--extension', 'antora-lfs']
    const playbook = buildPlaybook(args, {})
    const exts = playbook.antora.extensions
    expect(exts).to.include('antora-lunr')
    expect(exts).to.include('./lib/add-nojekyll.js')
    expect(exts).to.include('antora-lfs')
  })

  it('should set enabled flag on entry in require-array type from playbook file if arg value matches id of entry', () => {
    const args = ['--playbook', defaultSchemaSpec, '--extension', 'pdf-exporter']
    const playbook = buildPlaybook(args, {})
    const ext = playbook.antora.extensions.find((it) => it.id === 'pdf-exporter')
    expect(ext.enabled).to.be.true()
  })

  it('should not add duplicate entry to require-array', () => {
    const args = ['--playbook', defaultSchemaSpec, '--extension', 'antora-lunr', '--extension', 'antora-lunr']
    const playbook = buildPlaybook(args, {})
    // Q should the code check that isn't adding a duplicate even if entry has an id?
    const num = playbook.antora.extensions.reduce((accum, it) => (it === 'antora-lunr' ? accum + 1 : accum), 0)
    expect(num).to.equal(1)
  })

  it('should throw error if dir-or-virtual-files key is not a string or array', () => {
    Object.keys(schema).forEach((key) => {
      if (key !== 'playbook') delete schema[key]
    })
    schema.files = {
      format: 'dir-or-virtual-files',
      default: undefined,
    }
    expect(() => buildPlaybook([], { PLAYBOOK: invalidDirOrFilesSpec }, schema)).to.throw(
      'must be a directory path or list of virtual files'
    )
  })

  it('should throw error when key in playbook file is not declared in the schema', () => {
    const expected = `not declared in the schema for ${badSpec}`
    expect(() => buildPlaybook([], { PLAYBOOK: badSpec }, schema)).to.throw(expected)
  })

  it('should throw error with details when specified file is relative and has undeclared key', () => {
    const cwd = process.cwd()
    const playbook = ospath.relative(cwd, badSpec)
    const expected = `not declared in the schema for ${badSpec} (cwd: ${cwd}, playbook: ${playbook})`
    expect(() => buildPlaybook([], { PLAYBOOK: playbook }, schema)).to.throw(expected)
  })

  it('should throw error when playbook file uses values of the wrong format', () => {
    schema.two.format = String
    const expected = `must be of type String: value was 42 in ${ymlSpec}`
    expect(() => buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)).to.throw(expected)
  })

  it('should throw error with details when specified file is relative and has invalid value', () => {
    const cwd = process.cwd()
    const playbook = ospath.relative(cwd, ymlSpec)
    schema.two.format = String
    const expected = `must be of type String: value was 42 in ${ymlSpec} (cwd: ${cwd}, playbook: ${playbook})`
    expect(() => buildPlaybook([], { PLAYBOOK: playbook }, schema)).to.throw(expected)
  })

  it('should return an mutable playbook', () => {
    const playbook = buildPlaybook([], { PLAYBOOK: ymlSpec }, schema)
    expect(() => {
      playbook.one.two = 'override'
    }).not.to.throw()
  })

  it('should preserve case of keys in map if preserve is true', () => {
    schema = {
      playbook: {
        format: String,
        default: undefined,
        env: 'PLAYBOOK',
      },
      keyvals: {
        format: 'map',
        default: {},
        preserve: true,
      },
    }
    const playbook = buildPlaybook([], { PLAYBOOK: preserveAllKeysSpec }, schema)
    expect(playbook.keyvals).to.eql({ foo_bar: 'testing', 'yin-yang': 'zen' })
  })

  it('should preserve case of keys in map in entry if preserve is true', () => {
    schema = {
      playbook: {
        format: String,
        default: undefined,
        env: 'PLAYBOOK',
      },
      keyvals: {
        format: 'map',
        default: {},
      },
      entries: {
        format: Array,
        default: [],
        preserve: true,
      },
    }
    const playbook = buildPlaybook([], { PLAYBOOK: preserveSpecifiedKeysSpec }, schema)
    expect(playbook.keyvals).to.eql({ fooBar: 'testing', yinYang: 'zen', camelCaseThis: 'val' })
    const entry = playbook.entries[0]
    expect(entry.data).to.eql({ foo_bar: 'baz', 'yin-yang': 'zen' })
    expect(entry).to.have.property('not_data')
    expect(entry).not.to.have.property('notData')
    expect(entry.not_data).to.eql({ foo_bar: 'baz', 'yin-yang': 'zen' })
  })

  it('should preserve case of keys in entries specified by preserve', () => {
    schema = {
      playbook: {
        format: String,
        default: undefined,
        env: 'PLAYBOOK',
      },
      keyvals: {
        format: 'map',
        default: {},
      },
      entries: {
        format: Array,
        default: [],
        preserve: ['data'],
      },
    }
    const playbook = buildPlaybook([], { PLAYBOOK: preserveSpecifiedKeysSpec }, schema)
    const entry = playbook.entries[0]
    expect(playbook.keyvals).to.eql({ fooBar: 'testing', yinYang: 'zen', camelCaseThis: 'val' })
    expect(entry.data).to.eql({ foo_bar: 'baz', 'yin-yang': 'zen' })
    expect(entry.notData).to.eql({ fooBar: 'baz', yinYang: 'zen' })
  })

  it('should preserve case of keys when preserve is specified on sibling keys', () => {
    schema = {
      playbook: {
        format: String,
        default: undefined,
        env: 'PLAYBOOK',
      },
      keyvals: {
        format: 'map',
        default: {},
        preserve: true,
      },
      entries: {
        format: Array,
        default: [],
        preserve: ['data'],
      },
    }
    const playbook = buildPlaybook([], { PLAYBOOK: preserveSpecifiedKeysSpec }, schema)
    const entry = playbook.entries[0]
    expect(playbook.keyvals).to.eql({ foo_bar: 'testing', 'yin-yang': 'zen', '_camel-case-THIS': 'val' })
    expect(entry.data).to.eql({ foo_bar: 'baz', 'yin-yang': 'zen' })
    expect(entry.notData).to.eql({ fooBar: 'baz', yinYang: 'zen' })
  })

  it('should use default schema if no schema is specified', () => {
    const playbook = buildPlaybook(['--playbook', defaultSchemaSpec], { IS_TTY: 'false' })
    expect(playbook.runtime.cacheDir).to.equal('./.antora-cache')
    expect(playbook.runtime.fetch).to.be.true()
    expect(playbook.runtime.quiet).to.be.false()
    expect(playbook.runtime.silent).to.be.false()
    expect(playbook.runtime.log.level).to.equal('info')
    expect(playbook.runtime.log.levelFormat).to.equal('number')
    expect(playbook.runtime.log.failureLevel).to.equal('warn')
    expect(playbook.runtime.log.format).to.equal('json')
    expect(playbook.runtime.log.destination.file).to.equal('stdout')
    expect(playbook.runtime.log.destination.bufferSize).to.equal(4096)
    expect(playbook.runtime.log.destination.sync).to.equal(false)
    expect(playbook.runtime.log.destination.append).to.equal(false)
    expect(playbook.network.httpProxy).to.equal('http://proxy.example.org')
    expect(playbook.network.httpsProxy).to.equal('http://proxy.example.org')
    expect(playbook.network.noProxy).to.equal('example.org,example.com')
    expect(playbook.antora.generator).to.equal('my-custom-generator')
    expect(playbook.antora.extensions).to.eql([
      'antora-lunr',
      {
        id: 'pdf-exporter',
        require: '.:pdf-exporter',
        enabled: false,
        configPath: './pdf-config.yml',
        data: { key_name: 'value' },
      },
    ])
    expect(playbook.site.url).to.equal('https://example.com')
    expect(playbook.site.title).to.equal('Example site')
    expect(playbook.site.startPage).to.equal('1.0@server::intro')
    expect(playbook.site.keys.googleAnalytics).to.equal('XX-123456')
    expect(playbook.site.keys.jiraCollectorId).to.equal('xyz123')
    expect(playbook.content.branches).to.eql('HEAD, v*')
    expect(playbook.content.editUrl).to.equal('{web_url}/blob/{refname}/{path}')
    expect(playbook.content.sources).to.have.lengthOf(1)
    expect(playbook.content.sources[0]).to.eql({
      url: 'https://gitlab.com/antora/demo/demo-component-a.git',
      branches: ['main', 'v*'],
    })
    expect(playbook.ui.bundle.url).to.equal('./../ui/build/ui-bundle.zip')
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
    expect(playbook.asciidoc.sourcemap).to.be.false()
    expect(playbook.git.credentials.path).to.equal('./.git-credentials')
    expect(playbook.git.ensureGitSuffix).to.be.true()
    expect(playbook.git.fetchConcurrency).to.equal(5)
    expect(playbook.git.readConcurrency).to.equal(2)
    expect(playbook.git.plugins).to.include({ http: './lib/git-http-plugin.js' })
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

  it('should be able to use the merge operator in YAML to merge aliases into an object', () => {
    const playbook = buildPlaybook(['--playbook', contentSourceMergeSpec], {})
    expect(playbook).to.have.nested.property('content.sources')
    const sources = playbook.content.sources
    expect(sources).to.have.lengthOf(3)
    expect(sources[0]).to.have.property('url', 'https://git.example.org/project-a-docs.git')
    expect(sources[1]).to.have.property('url', 'https://git.example.org/project-b-docs.git')
    expect(sources[2]).to.have.property('url', 'https://git.example.org/project-c-docs.git')
    expect(sources[2]).to.eql({
      url: 'https://git.example.org/project-c-docs.git',
      branches: 'main',
      startPath: 'docs',
      version: true,
    })
  })

  it('should allow Google Analytics key to be defined via environment variable', () => {
    const playbook = buildPlaybook(['--playbook', defaultSchemaSpec], { GOOGLE_ANALYTICS_KEY: 'XX-abcxyz' })
    expect(playbook).to.have.nested.property('site.keys.googleAnalytics', 'XX-abcxyz')
  })

  it('should not allow Google Analytics key to be defined via arg', () => {
    const playbook = buildPlaybook(['--playbook', defaultSchemaSpec, '--google-analytics-key', 'XX-abcxyz'], {})
    expect(playbook).to.have.nested.property('site.keys.googleAnalytics', 'XX-123456')
  })

  it('should export default schema', () => {
    const playbook = buildPlaybook(['--playbook', defaultSchemaSpec], {}, buildPlaybook.defaultSchema)
    expect(playbook.site.url).to.equal('https://example.com')
  })

  it('should allow site.url to be a pathname', () => {
    const playbook = buildPlaybook(['--playbook', defaultSchemaSpec, '--url', '/docs'], {})
    expect(playbook.site.url).to.equal('/docs')
  })

  it('should throw error if site.url is a relative path', () => {
    expect(() => buildPlaybook(['--playbook', defaultSchemaSpec, '--url', 'docs'], {})).to.throw(
      'must be a valid URL or a pathname (i.e., root-relative path)'
    )
  })

  it('should throw error if site.url is a file URI', () => {
    expect(() => buildPlaybook(['--playbook', defaultSchemaSpec, '--url', 'file:///path/to/docs'], {})).to.throw(
      'must be an HTTP or HTTPS URL or a pathname (i.e., root-relative path)'
    )
  })

  it('should throw error if site.url is an invalid URL', () => {
    expect(() => buildPlaybook(['--playbook', defaultSchemaSpec, '--url', ':/foo'], {})).to.throw(
      'must be a valid URL or a pathname (i.e., root-relative path)'
    )
  })

  it('should throw error if site.url is not a string', () => {
    expect(() => buildPlaybook(['--playbook', invalidSiteUrlSpec], {})).to.throw('must be a string')
  })

  it('should throw error if site.url contains spaces', () => {
    expect(() => buildPlaybook(['--playbook', defaultSchemaSpec, '--url', 'https://example.org/my docs'], {})).to.throw(
      'pathname segment must not contain spaces'
    )
  })

  it('should throw error if url is not a string', () => {
    expect(() => buildPlaybook(['--playbook', defaultSchemaSpec], { http_proxy: 5 })).to.throw('must be a string')
  })

  it('should throw error if url is a file URI', () => {
    expect(() => buildPlaybook(['--playbook', defaultSchemaSpec, '--http-proxy', 'file:///proxy'], {})).to.throw(
      'must be an HTTP or HTTPS URL'
    )
  })

  it('should not camelCase the keys in the value of the version key on a content source', () => {
    const playbook = buildPlaybook(['--playbook', contentSourceVersionSpec], {})
    expect(playbook.content.sources).to.have.lengthOf(1)
    expect(playbook.content.sources[0]).to.have.property('version')
    expect(playbook.content.sources[0].version).to.be.instanceOf(Object)
    expect(Object.keys(playbook.content.sources[0].version)).to.eql(['release-(?<version>{0..9}+).x'])
  })

  it('should throw error if boolean-or-string key is not a boolean or string', () => {
    Object.keys(schema).forEach((key) => {
      if (key !== 'playbook') delete schema[key]
    })
    schema.edit_url = {
      format: 'boolean-or-string',
      default: undefined,
    }
    expect(() => buildPlaybook([], { PLAYBOOK: invalidStringOrBooleanSpec }, schema)).to.throw(
      'must be a boolean or string'
    )
  })

  it('should throw error if key is repeated in YAML', () => {
    expect(() => buildPlaybook([], { PLAYBOOK: invalidDuplicateKeySpec }, schema)).to.throw('duplicated mapping key')
  })

  it('should throw error if unrecognized YAML type tag is used', () => {
    expect(() => buildPlaybook([], { PLAYBOOK: invalidTypeTagSpec }, schema)).to.throw('unknown tag')
  })

  it('should not configure runtime.log.level if runtime.log is not present in schema', () => {
    const playbook = buildPlaybook([], { PLAYBOOK: yamlSpec }, schema)
    expect(playbook).to.not.have.property('runtime')
  })

  it('should call beforeValidate callbacks before validating playbook and exporting to model', () => {
    let logModel
    const playbook = buildPlaybook(['--playbook', defaultSchemaSpec, '--silent'], {}, undefined, (config) => {
      const log = config.get('runtime.log')
      if (log.level === 'silent') log.failure_level = 'none'
      log.level_format = 'label'
      config.set('runtime.log', log)
      logModel = config.getModel('runtime.log')
    })
    expect(playbook.runtime.silent).to.be.true()
    expect(playbook.runtime.quiet).to.be.true()
    expect(playbook.runtime.log.level).to.equal('silent')
    expect(playbook.runtime.log.failureLevel).to.equal('none')
    expect(playbook.runtime.log.levelFormat).to.equal('label')
    expect(playbook.runtime.log).to.eql(logModel)
    expect(Object.isFrozen(logModel)).to.be.false()
  })

  it('should set runtime.log.format to pretty when stdout is a TTY', () => {
    const oldIsTTY = process.stdout.isTTY
    try {
      process.stdout.isTTY = true
      const playbook = buildPlaybook(['--playbook', defaultSchemaSpec], {})
      expect(playbook.env.CI).to.be.undefined()
      expect(playbook.runtime.log.format).to.equal('pretty')
    } finally {
      process.stdout.isTTY = oldIsTTY
    }
  })

  it('should set runtime.log.format to pretty when CI=true and stdout is not a TTY', () => {
    const oldIsTTY = process.stdout.isTTY
    try {
      process.stdout.isTTY = undefined
      const playbook = buildPlaybook(['--playbook', defaultSchemaSpec], { CI: 'true' })
      expect(playbook.env.CI).to.equal('true')
      expect(playbook.runtime.log.format).to.equal('pretty')
    } finally {
      process.stdout.isTTY = oldIsTTY
    }
  })

  it('should set runtime.log.format to pretty when IS_TTY=true and stdout is not a TTY', () => {
    const oldIsTTY = process.stdout.isTTY
    try {
      process.stdout.isTTY = undefined
      const playbook = buildPlaybook(['--playbook', defaultSchemaSpec], { IS_TTY: 'true' })
      expect(playbook.env.IS_TTY).to.equal('true')
      expect(playbook.runtime.log.format).to.equal('pretty')
    } finally {
      process.stdout.isTTY = oldIsTTY
    }
  })

  it('should set runtime.log.format to json when CI is not set and stdout is not a TTY', () => {
    const oldIsTTY = process.stdout.isTTY
    try {
      process.stdout.isTTY = undefined
      const playbook = buildPlaybook(['--playbook', defaultSchemaSpec], {})
      expect(playbook.env.CI).to.be.undefined()
      expect(playbook.runtime.log.format).to.equal('json')
    } finally {
      process.stdout.isTTY = oldIsTTY
    }
  })

  it('should override dynamic default value for log format', () => {
    const playbook = buildPlaybook(['--playbook', runtimeLogFormatSpec], {})
    expect(playbook.runtime.log.format).to.equal('pretty')
  })

  it('should not accept playbook data that defines git.ensureGitSuffix', () => {
    expect(() => buildPlaybook(['--playbook', legacyGitEnsureGitSuffixSpec], {})).to.throw(/not declared in the schema/)
  })

  it('should not accept playbook data that defines runtime.pull', () => {
    expect(() => buildPlaybook(['--playbook', legacyRuntimePullSpec], {})).to.throw(/not declared in the schema/)
  })

  it('should not accept playbook data that defines ui.bundle as a String', () => {
    expect(() => buildPlaybook(['--playbook', legacyUiBundleSpec], {})).to.throw(/not declared in the schema/)
  })

  it('should not accept playbook data that defines ui.start_path', () => {
    expect(() => buildPlaybook(['--playbook', legacyUiStartPathSpec], {})).to.throw(/not declared in the schema/)
  })

  it('should throw when using default schema and no configuration data is specified', () => {
    expect(() => buildPlaybook()).to.throw()
  })

  it('should not throw when using default schema with no required keys and no configuration data is specified', () => {
    const playbook = buildPlaybook(undefined, {}, { key: { format: String, default: 'default-value' } })
    expect(playbook).to.have.property('key', 'default-value')
  })

  it('should be decoupled from the process environment when env is specified', () => {
    const oldEnv = process.env
    try {
      process.env = Object.assign({}, oldEnv, { URL: 'https://docs.example.org' })
      const env = { FOO: 'bar' }
      const playbook = buildPlaybook(['--ui-bundle-url', 'ui-bundle.zip'], env)
      expect(playbook.site.url).to.be.undefined()
      expect(playbook.env).to.equal(env)
    } finally {
      process.env = oldEnv
    }
  })

  it('should leave the process environment unchanged', () => {
    const processArgv = process.argv
    const processEnv = process.env
    const args = ['--one-one', 'the-args-value']
    const env = { PLAYBOOK: ymlSpec, ANTORA_TWO: 99 }
    const playbook = buildPlaybook(args, env, schema)
    expect(playbook.one.one).to.equal('the-args-value')
    expect(playbook.two).to.equal(99)
    expect(playbook.three).to.be.false()
    expect(process.argv).to.equal(processArgv)
    expect(process.env).to.equal(processEnv)
    expect(Object.isFrozen(process.env)).to.be.false()
    expect(playbook.env).to.equal(env)
  })

  it('should coerce values of process.env keys to string when assigned via playbook.env', () => {
    const processEnv = process.env
    try {
      const playbookEnv = buildPlaybook(['--ui-bundle-url', 'ui-bundle.zip']).env
      playbookEnv.TMP_ENV_VAR_ARRAY = ['a', 'b']
      playbookEnv.TMP_ENV_VAR_BOOLEAN = true
      playbookEnv.TMP_ENV_VAR_NUMBER = 5
      playbookEnv.TMP_ENV_VAR_OBJECT = { foo: 'bar' }
      expect(playbookEnv).to.equal(processEnv)
      expect(processEnv.TMP_ENV_VAR_ARRAY).to.equal('a,b')
      expect(processEnv.TMP_ENV_VAR_BOOLEAN).to.equal('true')
      expect(processEnv.TMP_ENV_VAR_NUMBER).to.equal('5')
      expect(processEnv.TMP_ENV_VAR_OBJECT).to.equal('[object Object]')
    } finally {
      delete processEnv.TMP_ENV_VAR_ARRAY
      delete processEnv.TMP_ENV_VAR_BOOLEAN
      delete processEnv.TMP_ENV_VAR_NUMBER
    }
  })
})

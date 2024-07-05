/* eslint-env mocha */
'use strict'

const { captureLogSync, expect } = require('@antora/test-harness')
const { resolveAsciiDocConfig } = require('@antora/asciidoc-loader')

const Asciidoctor = global.Opal.Asciidoctor
const ospath = require('path')

const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')

describe('resolveAsciiDocConfig()', () => {
  it('should export resolveAsciiDocConfig function', () => {
    expect(resolveAsciiDocConfig).to.be.a('function')
  })

  it('should return config with built-in attributes if site and asciidoc categories not set in playbook', () => {
    const config = resolveAsciiDocConfig()
    expect(config.attributes).to.exist()
    expect(config.attributes).to.include({
      env: 'site',
      'site-gen': 'antora',
      'attribute-missing': 'warn',
    })
    expect(config.attributes['site-title']).to.not.exist()
    expect(config.attributes['site-url']).to.not.exist()
    expect(config.extensions).to.not.exist()
  })

  it('should return config with attributes for site title and url if set in playbook', () => {
    const playbook = { site: { url: 'https://docs.example.org', title: 'Docs' }, ui: {} }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.attributes).to.exist()
    expect(config.attributes).to.include({
      'site-title': 'Docs',
      'site-url': 'https://docs.example.org',
    })
  })

  it('should ignore unresolved attribute reference', () => {
    const playbook = {
      file: '/path/to/antora-playbook.yml',
      asciidoc: {
        attributes: { 'name-of-attribute': '{foo} {bar}' },
      },
    }
    const { messages, returnValue: config } = captureLogSync(() => resolveAsciiDocConfig(playbook)).withReturnValue()
    expect(config.attributes).to.have.property('name-of-attribute', '{foo} {bar}')
    expect(messages).to.have.lengthOf(2)
    expect(messages[0]).to.eql({
      level: 'warn',
      name: '@antora/asciidoc-loader',
      msg: "Skipping reference to missing attribute 'foo' in value of 'name-of-attribute' attribute",
      file: { path: playbook.file },
    })
    expect(messages[1]).to.eql({
      level: 'warn',
      name: '@antora/asciidoc-loader',
      msg: "Skipping reference to missing attribute 'bar' in value of 'name-of-attribute' attribute",
      file: { path: playbook.file },
    })
  })

  it('should skip escaped attribute references', () => {
    const playbook = {
      file: '/path/to/antora-playbook.yml',
      asciidoc: {
        attributes: { 'name-of-attribute': '\\{foo} \\{bar}' },
      },
    }
    const { messages, returnValue: config } = captureLogSync(() => resolveAsciiDocConfig(playbook)).withReturnValue()
    expect(config.attributes).to.have.property('name-of-attribute', '{foo} {bar}')
    expect(messages).to.be.empty()
  })

  it('should not warn about unresolved attribute reference if attribute-missing attribute is not warn', () => {
    const playbook = {
      file: '/path/to/antora-playbook.yml',
      asciidoc: {
        attributes: { 'attribute-missing': null, 'name-of-attribute': '{foo} {bar}' },
      },
    }
    const { messages, returnValue: config } = captureLogSync(() => resolveAsciiDocConfig(playbook)).withReturnValue()
    expect(config.attributes).to.have.property('name-of-attribute', '{foo} {bar}')
    expect(messages).to.be.empty()
  })

  it('should resolve attribute reference to intrinsic attribute', () => {
    const playbook = {
      site: { url: 'https://docs.example.org' },
      asciidoc: {
        attributes: { 'url-archive': '{site-url}/archive' },
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.attributes).to.have.property('url-archive', 'https://docs.example.org/archive')
  })

  it('should resolve attribute reference to previously defined attribute', () => {
    const playbook = {
      asciidoc: {
        attributes: {
          'version-line-major': 3,
          'version-line-minor': 1,
          'version-line': '{version-line-major}.{version-line-minor}.x',
        },
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.attributes).to.have.property('version-line', '3.1.x')
  })

  it('should remove modifier when resolving reference to soft set attribute', () => {
    const playbook = {
      asciidoc: {
        attributes: {
          'org-name': 'ACME@',
          'company-name': '{org-name}',
          'brand-name': '{org-name}@',
          'product-name': '{brand-name} Search',
          'sponsor-name': '{company-name} Inc.@',
        },
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.attributes).to.have.property('org-name', 'ACME@')
    expect(config.attributes).to.have.property('company-name', 'ACME')
    expect(config.attributes).to.have.property('brand-name', 'ACME@')
    expect(config.attributes).to.have.property('product-name', 'ACME Search')
    expect(config.attributes).to.have.property('sponsor-name', 'ACME Inc.@')
  })

  it('should resolve reference to attribute with non-string value', () => {
    const playbook = {
      asciidoc: {
        attributes: {
          experimental: true,
          icons: '{experimental}',
          'allow-uri-read': '{data-uri}',
          toclevels: 0,
          sectnumlevels: '{toclevels}',
        },
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.attributes).to.have.property('icons', true)
    expect(config.attributes).to.have.property('allow-uri-read', null)
    expect(config.attributes).to.have.property('toclevels', 0)
    expect(config.attributes).to.have.property('sectnumlevels', 0)
  })

  it('should skip attribute reference to unset attribute', () => {
    const playbook = {
      asciidoc: {
        attributes: {
          icons: null,
          'icons-desc': 'using {icons}-based icons',
        },
      },
    }
    const { messages, returnValue: config } = captureLogSync(() => resolveAsciiDocConfig(playbook)).withReturnValue()
    expect(config.attributes).to.have.property('icons-desc', 'using {icons}-based icons')
    expect(messages).to.have.lengthOf(1)
  })

  it('should skip attribute reference to false attribute', () => {
    const playbook = {
      asciidoc: {
        attributes: {
          icons: false,
          'icons-desc': 'using {icons}-based icons',
        },
      },
    }
    const { messages, returnValue: config } = captureLogSync(() => resolveAsciiDocConfig(playbook)).withReturnValue()
    expect(config.attributes).to.have.property('icons-desc', 'using {icons}-based icons')
    expect(messages).to.have.lengthOf(1)
  })

  it('should skip invalid attribute reference', () => {
    const playbook = {
      asciidoc: {
        attributes: { 'attribute-name': '{foo.bar.baz}' },
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.attributes).to.have.property('attribute-name', '{foo.bar.baz}')
  })

  it('should resolve multiple attribute references in same value', () => {
    const playbook = {
      site: { url: 'https://docs.example.org', title: 'Docs' },
      asciidoc: {
        attributes: { 'site-link': '{site-url}[{site-title}]' },
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.attributes).to.have.property('site-link', 'https://docs.example.org[Docs]')
  })

  it('should return a copy of the asciidoc category in the playbook', () => {
    const playbook = {
      asciidoc: {
        attributes: {
          idprefix: '',
          idseparator: '-',
        },
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config).to.not.equal(playbook.asciidoc)
    expect(config.attributes).to.not.equal(playbook.asciidoc.attributes)
    expect(config.attributes).to.include(playbook.asciidoc.attributes)
  })

  it('should not load extensions if extensions are not defined', () => {
    const playbook = { asciidoc: {} }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.extensions).to.not.exist()
  })

  it('should not load extensions if extensions are empty', () => {
    const playbook = { asciidoc: { extensions: [] } }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.extensions).to.not.exist()
  })

  it('should load scoped extension into config but not register it globally', () => {
    const playbook = { asciidoc: { extensions: [ospath.resolve(FIXTURES_DIR, 'ext/scoped-shout-block.js')] } }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.extensions).to.exist()
    expect(config.extensions).to.have.lengthOf(1)
    expect(config.extensions[0]).to.be.instanceOf(Function)
    const Extensions = Asciidoctor.Extensions
    const extensionGroupNames = Object.keys(Extensions.getGroups())
    expect(extensionGroupNames).to.be.empty()
  })

  it('should load global extension and register it globally', () => {
    const Extensions = Asciidoctor.Extensions
    try {
      const playbook = { asciidoc: { extensions: [ospath.resolve(FIXTURES_DIR, 'ext/global-shout-block.js')] } }
      const config = resolveAsciiDocConfig(playbook)
      expect(config.extensions).to.not.exist()
      const extensionGroupNames = Object.keys(Extensions.getGroups())
      expect(extensionGroupNames).to.have.lengthOf(1)
    } finally {
      Extensions.unregisterAll()
    }
  })

  it('should only register a global extension once', () => {
    const Extensions = Asciidoctor.Extensions
    try {
      const playbook = { asciidoc: { extensions: [ospath.resolve(FIXTURES_DIR, 'ext/global-shout-block.js')] } }
      resolveAsciiDocConfig(playbook)
      resolveAsciiDocConfig(playbook)
      const extensionGroupNames = Object.keys(Extensions.getGroups())
      expect(extensionGroupNames).to.have.lengthOf(1)
    } finally {
      Extensions.unregisterAll()
    }
  })

  it('should load extension at path relative to playbook dir', () => {
    const playbook = {
      dir: FIXTURES_DIR,
      asciidoc: {
        extensions: ['./ext/scoped-shout-block.js'],
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.extensions).to.exist()
    expect(config.extensions).to.have.lengthOf(1)
    expect(config.extensions[0]).to.be.instanceOf(Function)
  })

  it('should load extension at extensionless path relative to playbook dir', () => {
    const playbook = {
      dir: FIXTURES_DIR,
      asciidoc: {
        extensions: ['./ext/scoped-shout-block'],
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.extensions).to.exist()
    expect(config.extensions).to.have.lengthOf(1)
    expect(config.extensions[0]).to.be.instanceOf(Function)
  })

  it('should load extension from module in node_modules directory relative to playbook dir', () => {
    const playbook = {
      dir: FIXTURES_DIR,
      asciidoc: {
        extensions: ['lorem-block-macro'],
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.extensions).to.exist()
    expect(config.extensions).to.have.lengthOf(1)
    expect(config.extensions[0]).to.be.instanceOf(Function)
  })

  it('should load extension from module in node_modules directory relative to cwd', () => {
    const oldCwd = process.cwd()
    try {
      process.chdir(FIXTURES_DIR)
      const playbook = {
        dir: __dirname,
        asciidoc: {
          extensions: ['~+:lorem-block-macro'],
        },
      }
      const config = resolveAsciiDocConfig(playbook)
      expect(config.extensions).to.exist()
      expect(config.extensions).to.have.lengthOf(1)
      expect(config.extensions[0]).to.be.instanceOf(Function)
    } finally {
      process.chdir(oldCwd)
    }
  })

  it('should load extension from module at absolute path', () => {
    const playbook = {
      dir: __dirname,
      asciidoc: {
        extensions: [ospath.join(FIXTURES_DIR, 'node_modules', 'lorem-block-macro')],
      },
    }
    const config = resolveAsciiDocConfig(playbook)
    expect(config.extensions).to.exist()
    expect(config.extensions).to.have.lengthOf(1)
    expect(config.extensions[0]).to.be.instanceOf(Function)
  })

  it('should load all extensions', () => {
    const Extensions = Asciidoctor.Extensions
    try {
      const playbook = {
        dir: FIXTURES_DIR,
        asciidoc: {
          extensions: [
            './ext/scoped-shout-block.js',
            'lorem-block-macro',
            ospath.resolve(FIXTURES_DIR, 'ext/global-shout-block.js'),
          ],
        },
      }
      const config = resolveAsciiDocConfig(playbook)
      expect(config.extensions).to.exist()
      expect(config.extensions).to.have.lengthOf(2)
      expect(config.extensions[0]).to.be.instanceOf(Function)
      expect(config.extensions[1]).to.be.instanceOf(Function)
      const extensionGroupNames = Object.keys(Extensions.getGroups())
      expect(extensionGroupNames).to.have.lengthOf(1)
    } finally {
      Extensions.unregisterAll()
    }
  })

  it('should detect and warn if Antora extension is registered as Asciidoctor extension', () => {
    const antoraExtensionPath = ospath.resolve(FIXTURES_DIR, 'ext/antora-ext.js')
    const playbook = {
      dir: FIXTURES_DIR,
      asciidoc: { extensions: ['./ext/scoped-shout-block.js', antoraExtensionPath] },
    }
    const { messages, returnValue: config } = captureLogSync(() => resolveAsciiDocConfig(playbook)).withReturnValue()
    expect(config.extensions).to.exist()
    expect(config.extensions).to.have.lengthOf(1)
    expect(messages).to.have.lengthOf(1)
    expect(messages[0]).to.eql({
      level: 'warn',
      name: '@antora/asciidoc-loader',
      msg: `Skipping possible Antora extension registered as an Asciidoctor extension: ${antoraExtensionPath}`,
    })
  })
})

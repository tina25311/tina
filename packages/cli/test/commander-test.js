/* eslint-env mocha */
'use strict'

const { expect } = require('@antora/test-harness')

const { Command } = require('#commander')
const convict = require('convict')

describe('commander', () => {
  describe('parse()', () => {
    class ProcessExit extends Error {
      constructor (code) {
        super('process exit')
        this.code = code
      }
    }

    const trapExit = (block) => {
      const $exit = process.exit
      process.exit = (code) => {
        throw new ProcessExit(code)
      }
      try {
        block()
      } finally {
        process.exit = $exit
      }
    }

    const createCli = (name, defaultCommand = undefined) =>
      new Command()
        .storeOptionsAsProperties()
        .name(name)
        .option('--silent', 'Silence is golden')
        .command('sync', { isDefault: defaultCommand === 'sync' })
        .action((cmd) => (lastCommand = 'sync'))
        .parent.command('run', { isDefault: defaultCommand === 'run' })
        .option('--title <title>', 'Site title')
        .option('--url <url>', 'Site URL')
        .action((cmd) => (lastCommand = 'run')).parent

    let lastCommand

    beforeEach(() => {
      lastCommand = undefined
    })

    it('should run default command if no commands, options, or arguments are specified', () => {
      trapExit(() => {
        let helpShown
        const command = createCli('cli', 'sync')
        command.outputHelp = () => (helpShown = true)
        command.parse(['node', 'cli'])
        expect(() => command.parse(['node', 'cli'])).to.not.throw(ProcessExit)
        expect(lastCommand).to.equal('sync')
        expect(helpShown).to.be.undefined()
      })
    })

    it('should output help if commands are defined but no command is specified', () => {
      trapExit(() => {
        let helpShown
        const command = createCli('cli')
        command.outputHelp = () => (helpShown = true)
        expect(() => command.parse(['node', 'cli', '--silent']))
          .to.throw(ProcessExit)
          .with.property('code', 1)
        expect(command.rawArgs.slice(2)).to.eql(['--silent'])
        expect(helpShown).to.be.true()
      })
    })

    it('should insert default command if no command is present', () => {
      const command = createCli('cli', 'run').parse(['node', 'cli', '--silent'])
      expect(command.rawArgs.slice(2)).to.eql(['--silent'])
      expect(command).to.have.property('silent', true)
      expect(lastCommand).to.equal('run')
    })

    it('should not insert default command if already present', () => {
      const command = createCli('cli', 'run').parse(['node', 'cli', 'run'])
      expect(command.rawArgs.slice(2)).to.eql(['run'])
      expect(lastCommand).to.equal('run')
    })

    it('should not insert default command if -h is specified', () => {
      trapExit(() => {
        let helpShown
        const command = createCli('cli', 'sync')
        command.outputHelp = () => (helpShown = true)
        expect(() => command.parse(['node', 'cli', '-h']))
          .to.throw(ProcessExit)
          .with.property('code', 0)
        expect(command.rawArgs.slice(2)).to.eql(['-h'])
        expect(helpShown).to.be.true()
        expect(lastCommand).to.be.undefined()
      })
    })

    it('should not insert default command if --help is specified', () => {
      trapExit(() => {
        let helpShown
        const command = createCli('cli', 'sync')
        command.outputHelp = () => (helpShown = true)
        expect(() => command.parse(['node', 'cli', '--help']))
          .to.throw(ProcessExit)
          .with.property('code', 0)
        expect(command.rawArgs.slice(2)).to.eql(['--help'])
        expect(helpShown).to.be.true()
        expect(lastCommand).to.be.undefined()
      })
    })

    it('should insert default command before other arguments and options', () => {
      const command = createCli('cli', 'run')
      command.parse(['node', 'cli', '--title', 'Docs', '--url', 'https://docs.example.com'])
      expect(command.rawArgs.slice(2)).to.eql(['--title', 'Docs', '--url', 'https://docs.example.com'])
      expect(lastCommand).to.equal('run')
      const runCommand = command.commands.find((candidate) => candidate.name() === 'run')
      expect(runCommand).to.exist()
      expect(runCommand).to.have.property('title', 'Docs')
      expect(runCommand).to.have.property('url', 'https://docs.example.com')
    })
  })

  describe('optionsFromConvict()', () => {
    let $argv
    let $env

    const createCli = (schema, opts = undefined) => new Command('cli').optionsFromConvict(convict(schema), opts)

    before(() => {
      $argv = process.argv
      $env = process.env
      process.argv = ['node', 'cli']
      process.env = {}
    })

    after(() => {
      process.argv = $argv
      process.env = $env
    })

    it('should import option with required argument from convict config', () => {
      const configSchema = {
        host: {
          arg: 'host',
          default: 'localhost',
          doc: 'Server hostname',
          format: String,
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname',
        defaultValue: 'localhost',
      })
    })

    it('should not mark option imported from convict config as required if default is undefined', () => {
      const configSchema = {
        host: {
          arg: 'host',
          default: undefined,
          doc: 'Server hostname',
          format: String,
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname',
      })
    })

    it('should mark option imported from convict config as required if default is null', () => {
      const configSchema = {
        host: {
          arg: 'host',
          default: null,
          doc: 'Server hostname',
          format: String,
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname (required)',
        required: true,
      })
    })

    it('should not set default on option if default is object', () => {
      const configSchema = {
        attributes: {
          arg: 'attribute',
          default: {},
          doc: 'A document attribute',
          format: Object,
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--attribute',
        flags: '--attribute <attribute>',
        description: configSchema.attributes.doc,
      })
      expect(options[0].defaultValue).to.be.undefined()
    })

    it('should not set default on option if default is array', () => {
      const configSchema = {
        extensions: {
          arg: 'extension',
          default: [],
          doc: 'An extension require path or ID',
          format: Array,
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--extension',
        flags: '--extension <extension>',
        description: configSchema.extensions.doc,
      })
      expect(options[0].defaultValue).to.be.undefined()
    })

    it('should import boolean option from convict config', () => {
      const configSchema = {
        quiet: {
          arg: 'quiet',
          default: false,
          doc: 'Be quiet',
          format: Boolean,
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--quiet',
        flags: '--quiet',
        description: 'Be quiet',
      })
      expect(options[0]).to.have.property('defaultValue')
      expect(options[0].defaultValue).to.be.undefined()
    })

    it('should import negatable boolean option from convict config', () => {
      const configSchema = {
        cache: {
          arg: 'no-cache',
          default: true,
          doc: 'Do not use cache',
          format: Boolean,
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--no-cache',
        flags: '--no-cache',
        description: 'Do not use cache',
        defaultValue: true,
      })
    })

    it('should derive argument placeholder from option name', () => {
      const configSchema = {
        urlStrategy: {
          arg: 'to-dir',
          default: 'build/site',
          doc: 'The base URL (absolute URL or pathname) of the published site.',
          format: String,
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--to-dir',
        flags: '--to-dir <dir>',
        description: 'The base URL (absolute URL or pathname) of the published site.',
        defaultValue: 'build/site',
      })
    })

    it('should include enumeration options in description', () => {
      const configSchema = {
        urlStrategy: {
          arg: 'url-strategy',
          default: 'default',
          doc: 'URL strategy',
          format: ['default', 'drop', 'indexify'],
        },
      }
      const cli = createCli(configSchema)
      const options = cli.options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--url-strategy',
        flags: '--url-strategy <choice>',
        description: 'URL strategy',
        defaultValue: 'default',
      })
      expect(options[0].argChoices).to.eql(['default', 'drop', 'indexify'])
      expect(cli.createHelp().optionDescription(options[0])).to.equal(
        'URL strategy (choices: default, drop, indexify, default: default)'
      )
    })

    it('should import multiple options from convict config', () => {
      const configSchema = {
        host: {
          arg: 'host',
          default: 'localhost',
          doc: 'Server hostname',
          format: String,
        },
        port: {
          arg: 'port',
          default: '9191',
          doc: 'Server port',
          format: 'port',
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(2)
      expect(options[0]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname',
        defaultValue: 'localhost',
      })
      expect(options[1]).to.include({
        long: '--port',
        flags: '--port <port>',
        description: 'Server port',
        defaultValue: '9191',
      })
    })

    it('should import nested options from convict config', () => {
      const configSchema = {
        site: {
          title: {
            arg: 'title',
            default: 'The Title',
            doc: 'Site title',
            format: String,
          },
        },
        server: {
          host: {
            arg: 'host',
            default: 'localhost',
            doc: 'Server hostname',
            format: String,
          },
          port: {
            arg: 'port',
            default: '9191',
            doc: 'Server port',
            format: 'port',
          },
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(3)
      expect(options[0]).to.include({
        long: '--title',
        flags: '--title <title>',
        description: 'Site title',
        defaultValue: 'The Title',
      })
      expect(options[1]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname',
        defaultValue: 'localhost',
      })
      expect(options[2]).to.include({
        long: '--port',
        flags: '--port <port>',
        description: 'Server port',
        defaultValue: '9191',
      })
    })

    it('should skip option from convict config if marked as excluded', () => {
      const configSchema = {
        site: {
          title: {
            arg: 'title',
            default: 'The Title',
            doc: 'Site title',
            format: String,
          },
        },
        server: {
          host: {
            arg: 'host',
            default: 'localhost',
            doc: 'Server hostname',
            format: String,
          },
          port: {
            arg: 'port',
            default: '9191',
            doc: 'Server port',
            format: 'port',
          },
        },
      }
      const options = createCli(configSchema, { exclude: 'title' }).options
      expect(options).to.have.lengthOf(2)
      expect(options[0]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname',
        defaultValue: 'localhost',
      })
      expect(options[1]).to.include({
        long: '--port',
        flags: '--port <port>',
        description: 'Server port',
        defaultValue: '9191',
      })
    })

    it('should skip options from convict config if marked as excluded', () => {
      const configSchema = {
        site: {
          title: {
            arg: 'title',
            default: 'The Title',
            doc: 'Site title',
            format: String,
          },
        },
        server: {
          host: {
            arg: 'host',
            default: 'localhost',
            doc: 'Server hostname',
            format: String,
          },
          port: {
            arg: 'port',
            default: '9191',
            doc: 'Server port',
            format: 'port',
          },
        },
      }
      const options = createCli(configSchema, { exclude: ['title', 'port'] }).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname',
        defaultValue: 'localhost',
      })
    })

    it('should skip options in convict config without an arg', () => {
      const configSchema = {
        site: {
          title: {
            default: 'The Title',
            doc: 'Site title',
            format: String,
          },
        },
        server: {
          host: {
            arg: 'host',
            default: 'localhost',
            doc: 'Server hostname',
            format: String,
          },
          port: {
            default: '9191',
            doc: 'Server port',
            format: 'port',
          },
        },
      }
      const options = createCli(configSchema).options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname',
        defaultValue: 'localhost',
      })
    })

    it('should add option from convict config to command', () => {
      const configSchema = {
        host: {
          arg: 'host',
          default: 'localhost',
          doc: 'Server hostname',
          format: String,
        },
      }
      const cli = createCli({})
      cli.command('generate').optionsFromConvict(convict(configSchema))
      const options = cli.commands.find((candidate) => candidate.name() === 'generate').options
      expect(options).to.have.lengthOf(1)
      expect(options[0]).to.include({
        long: '--host',
        flags: '--host <host>',
        description: 'Server hostname',
        defaultValue: 'localhost',
      })
    })
  })
})

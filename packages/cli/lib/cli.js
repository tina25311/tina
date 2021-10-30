#!/usr/bin/env node

'use strict'

const buildPlaybook = require('@antora/playbook-builder')
const cli = require('./commander')
const convict = require('@antora/playbook-builder/lib/solitary-convict')
const { configureLogger, getLogger, finalizeLogger } = require('@antora/logger')
const ospath = require('path')
const userRequire = require('@antora/user-require-helper')

const { version: VERSION } = require('../package.json')

async function run (argv = process.argv) {
  const args = argv.slice(2)
  return cli.parseAsync(args.length ? args : ['help'], { from: 'user' })
}

function exitWithError (err, opts, msg = undefined) {
  if (!msg) msg = err.message || err
  const name = msg.startsWith('asciidoctor: FAILED: ') ? (msg = msg.slice(21)) && 'asciidoctor' : cli.name()
  const logger = getLogger(null)
    ? getLogger(name)
    : configureLogger({ format: 'pretty', level: opts.silent ? 'silent' : 'fatal', failureLevel: 'fatal' }).get(name)
  if (opts.stacktrace) {
    let loc, stack
    if ((stack = err.backtrace)) {
      err = Object.assign(new Error(msg), { stack: ['Error', ...stack.slice(1)].join('\n') })
    } else if ((stack = err.stack)) {
      if (err instanceof SyntaxError && stack.includes('\nSyntaxError: ')) {
        ;[loc, stack] = stack.split(/\n+SyntaxError: [^\n]+/)
        err = Object.assign(new SyntaxError(msg), { stack: stack.replace('\n', `SyntaxError\n    at ${loc}\n`) })
      } else if (stack.startsWith(`${err.name}: ${msg}`)) {
        stack = stack.replace(`${err.name}: ${msg}`, '').replace(/^\n/, '')
        err = Object.assign(new err.constructor(msg), { stack: stack ? `${err.name}\n${stack}` : undefined })
      }
    } else {
      err = Object.assign(new Error(msg), { stack: undefined })
    }
    if ({}.propertyIsEnumerable.call(err, 'name')) Object.defineProperty(err, 'name', { enumerable: false })
    err.stack = `Cause: ${err.stack || '(no stacktrace)'}`
    logger.fatal(err, msg)
  } else {
    logger.fatal(msg + '\nAdd the --stacktrace option to see the cause of the error.')
  }
  return exit()
}

function exit () {
  return finalizeLogger().then((failOnExit) => process.exit(failOnExit ? 1 : process.exitCode))
}

function getTTYColumns () {
  return process.env.COLUMNS || process.stdout.columns || 80
}

function outputError (str, write) {
  write(str.replace(/^error: /, cli.name() + ': '))
}

cli
  .allowExcessArguments(false)
  .configureOutput({ getOutHelpWidth: getTTYColumns, getErrHelpWidth: getTTYColumns, outputError })
  .storeOptionsAsProperties()
  .name('antora')
  .version(
    {
      toString () {
        const generator = cli._findCommand('generate').getOptionValue('generator')
        const buffer = ['@antora/cli: ' + VERSION]
        let generatorVersion
        const generatorPackageJson = generator + '/package.json'
        try {
          generatorVersion = require(generatorPackageJson).version
        } catch {
          try {
            generatorVersion = require(require.resolve(generatorPackageJson, { paths: [''] })).version
          } catch {}
        }
        buffer.push(generator + ': ' + (generatorVersion || 'not installed'))
        return buffer.join('\n')
      },
    },
    '-v, --version',
    'Output the version of the CLI and default site generator.'
  )
  .description('A modular, multi-repository documentation site generator for AsciiDoc.')
  .usage('[options] [[command] [args]]')
  .helpOption('-h, --help', 'Output usage information.')
  .addHelpText('after', () => {
    const name = cli.name()
    return cli
      .createHelp()
      .wrap(
        ` \nRun '${name} <command> --help' to see options and examples for a command (e.g., ${name} generate --help).`,
        getTTYColumns(),
        0
      )
  })
  .option('-r, --require <library>', 'Require library (aka node module) or script path before executing command.')
  .on('option:require', (requireRequest) => (cli.requireRequests = cli.requireRequests || []).push(requireRequest))
  .option('--stacktrace', 'Print the stacktrace to the console if the application fails.')

cli
  .command('generate <playbook>', { isDefault: true })
  .description('Generate a documentation site as specified by <playbook>.')
  .optionsFromConvict(convict(buildPlaybook.defaultSchema), { exclude: 'playbook' })
  .trackOptions()
  .action(async (playbookFile, options, command) => {
    const errorOpts = { stacktrace: cli.stacktrace, silent: command.silent }
    const playbookDir = ospath.resolve(playbookFile, '..')
    const userRequireContext = { dot: playbookDir, paths: [playbookDir, __dirname] }
    if (cli.requireRequests) {
      try {
        cli.requireRequests.forEach((requireRequest) => userRequire(requireRequest, userRequireContext))
      } catch (err) {
        return exitWithError(err, errorOpts)
      }
    }
    const args = command.optionArgs.concat('--playbook', playbookFile)
    let playbook
    try {
      playbook = buildPlaybook(args, process.env, buildPlaybook.defaultSchema, (config) => {
        try {
          configureLogger(config.getModel('runtime.log'), playbookDir)
        } catch {}
      })
    } catch (err) {
      return exitWithError(err, errorOpts)
    }
    const generator = playbook.antora.generator
    let generateSite
    try {
      generateSite =
        (generateSite = userRequire(generator, userRequireContext)).length === 1
          ? generateSite.bind(null, playbook)
          : generateSite.bind(null, args, process.env)
    } catch (err) {
      let msg = 'Generator not found or failed to load.'
      if (generator && generator.charAt() !== '.') msg += ` Try installing the '${generator}' package.`
      return exitWithError(err, errorOpts, msg)
    }
    return generateSite()
      .then(exit)
      .catch((err) => exitWithError(err, errorOpts))
  })
  .options.sort((a, b) => a.long.localeCompare(b.long))

cli.command('help [command]', { hidden: true }).action((name, options, command) => {
  if (name) {
    const helpCommand = cli._findCommand(name)
    if (helpCommand) {
      helpCommand.help()
    } else {
      const message = `error: unknown command '${name}'. See '${cli.name()} --help' for a list of commands.`
      cli._displayError(1, 'commander.unknownCommand', message)
    }
  } else {
    cli.help()
  }
})

cli.command('version', { hidden: true }).action(() => cli.emit('option:version'))

module.exports = run

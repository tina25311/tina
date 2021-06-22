'use strict'

const { Command } = require('commander')

Command.prototype.optionsFromConvict = function (convictConfig, opts = {}) {
  let exclude = opts.exclude
  if (exclude && !Array.isArray(exclude)) exclude = [exclude]
  getOptions(convictConfig).forEach((option) => {
    if (exclude && exclude.includes(option.name)) return
    this.addOption(this.createOption(option.form, option.description).default(option.default, option.default))
  })
  return this
}

function getOptions (config) {
  //return collectOptions(config._schema._cvtProperties).sort((a, b) => a.name.localeCompare(b.name))
  return collectOptions(config._schema._cvtProperties)
}

function collectOptions (props, context = undefined) {
  return Object.entries(props).reduce((accum, [key, value]) => {
    if ('_cvtProperties' in value) {
      accum.push(...collectOptions(value._cvtProperties, context ? `${context}.${key}` : key))
    } else if ('arg' in value) {
      const { arg, format, default: default_ } = value
      const option = { name: arg, form: `--${arg}`, description: value.doc, format: format }
      if (Array.isArray(format)) {
        option.form += ' <option>'
        const last = format.length - 1
        option.description += ` (options: ${format.slice(0, last).join(', ')}${last > 1 ? ',' : ''} or ${format[last]})`
      } else if (format !== 'boolean') {
        option.form += ` <${arg.substr(arg.lastIndexOf('-') + 1, arg.length)}>`
      }
      if (default_ === null) {
        //option.mandatory = true
        option.description += ' (required)'
      } else if (default_ && (typeof default_ !== 'object' || default_.toString() !== '[object Object]')) {
        option.default = default_
      }
      accum.push(option)
      //if (format === 'boolean') accum.push({ form: `--no-${arg}`, format: format })
    }
    return accum
  }, [])
}

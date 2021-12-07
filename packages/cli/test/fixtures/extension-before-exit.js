'use strict'

module.exports.register = () => {
  process.on('beforeExit', () => console.log('saying goodbye'))
  process.on('exit', () => console.log('goodbye'))
}

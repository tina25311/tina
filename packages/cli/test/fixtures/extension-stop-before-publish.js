'use strict'

module.exports.register = function ({ config: { exitCode } }) {
  this.on('beforePublish', () => {
    process.exitCode = exitCode || 0
    this.stop()
  })
}

'use strict'

module.exports.register = function () {
  this.once('playbookBuilt', () => {
    this.stop()
  })
}

'use strict'

module.exports.register = () => {
  let beforeExitCalled
  process.on('beforeExit', () => {
    if (beforeExitCalled) return
    beforeExitCalled = true
    console.log('saying goodbye')
    return new Promise((resolve) => setTimeout(() => resolve(console.log('done goodbyes')), 250))
  })
  process.on('exit', () => console.log('goodbye'))
}

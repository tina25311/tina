'use strict'

module.exports.register = () => {
  let beforeExitCalled
  process.on('beforeExit', async () => {
    if (beforeExitCalled) return
    beforeExitCalled = true
    console.log('saying goodbye')
    await new Promise((resolve) => setTimeout(() => resolve(console.log('done goodbyes')), 250))
  })
  process.on('exit', () => console.log('goodbye'))
}

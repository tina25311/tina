'use strict'

module.exports = (chai) => {
  chai.Assertion.addMethod('startWith', function (expected) {
    const subject = this._obj
    let verdict = false
    if (typeof subject === 'string' && typeof expected === 'string') verdict = subject.startsWith(expected)
    return this.assert(
      verdict,
      'expected #{this} to start with #{exp}',
      'expected #{this} to not start with #{exp}',
      expected,
      undefined
    )
  })
}

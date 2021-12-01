'use strict'

module.exports = (chai) => {
  chai.Assertion.addMethod('endWith', function (expected) {
    const subject = this._obj
    let verdict = false
    if (typeof subject === 'string' && typeof expected === 'string') verdict = subject.endsWith(expected)
    return this.assert(
      verdict,
      'expected #{this} to end with #{exp}',
      'expected #{this} to not end with #{exp}',
      expected,
      undefined
    )
  })
}

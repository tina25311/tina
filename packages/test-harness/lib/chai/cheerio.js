'use strict'

function inspectNode () {
  return `<${this.get(0).tagName}>`
}

module.exports = (chai, utils) => {
  const { flag, inspect } = utils
  const getNode = (assertion) => {
    const node = flag(assertion, 'object')
    node.inspect = inspectNode
    return node
  }

  chai.Assertion.addMethod('attr', function (name, val) {
    const actual = getNode(this).attr(name)
    if (val === undefined) {
      this.assert(
        actual !== undefined,
        'expected #{this} to have attribute #{exp}',
        'expected #{this} to not have attribute #{exp}',
        name
      )
    } else {
      this.assert(
        val === actual,
        'expected #{this} to have attribute ' + inspect(name) + ' with the value #{exp}, but the value was #{act}',
        'expected #{this} to not have attribute ' + inspect(name) + ' with the value #{act}',
        val,
        actual
      )
    }
  })

  chai.Assertion.addMethod('class', function (val) {
    const actual = getNode(this).hasClass(val)
    this.assert(actual, 'expected #{this} to have class #{exp}', 'expected #{this} to not have class #{exp}', val)
  })

  chai.Assertion.addMethod('found', function () {
    this.assert(getNode(this).length > 0, 'expected element to be found', 'expected element to not be found')
  })

  chai.Assertion.addMethod('html', function (val) {
    const actual = getNode(this).html()
    this.assert(
      actual === val,
      'expected #{this} to have HTML #{exp}, but got #{act}',
      'expected #{this} to not have HTML #{exp}',
      val,
      actual
    )
  })

  chai.Assertion.addMethod('text', function (val) {
    const actual = getNode(this).text()
    this.assert(
      actual === val,
      'expected #{this} to have text #{exp}, but the text was #{act}',
      'expected #{this} to not have text #{exp}',
      val,
      actual
    )
  })
}

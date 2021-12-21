/* eslint-env mocha */
'use strict'

const { expect } = require('@antora/test-harness')

describe('site-generator-default', () => {
  it('should serve as alias for @antora/site-generator', () => {
    const expected = require('@antora/site-generator')
    const actual = require('@antora/site-generator-default')
    expect(actual).to.equal(expected)
    expect(actual.name).to.equal('generateSite')
    expect(actual).to.have.lengthOf(1)
    expect(actual.toString().split('\n')[0].replace(' (', '(')).to.include('generateSite(playbook)')
  })
})

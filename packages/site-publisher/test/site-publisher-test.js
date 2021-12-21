/* eslint-env mocha */
'use strict'

const { expect } = require('@antora/test-harness')

describe('site-publisher', () => {
  it('should serve as alias for @antora/file-publisher', () => {
    const expected = require('@antora/file-publisher')
    const actual = require('@antora/site-publisher')
    expect(actual).to.equal(expected)
    expect(actual.name).to.equal('publishFiles')
    expect(actual).to.have.lengthOf(2)
    expect(actual.toString().split('\n')[0].replace(' (', '(').replace(', ', ',')).to.include(
      'publishFiles(playbook,catalogs)'
    )
  })
})

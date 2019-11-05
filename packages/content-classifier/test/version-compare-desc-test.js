/* eslint-env mocha */
'use strict'

const { expect } = require('../../../test/test-utils')
const versionCompareDesc = require('@antora/content-classifier/lib/util/version-compare-desc')

describe('versionCompareDesc()', () => {
  it('should consider same version string as equal', () => {
    expect(versionCompareDesc('1.0', '1.0')).to.equal(0)
  })

  it('should weigh number higher than non-number in semantic version', () => {
    const versions = ['1.x', '1.0', '2.0', '2.x']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['2.0', '2.x', '1.0', '1.x'])
  })

  it('should order versions with same number of segments in descending semantic order', () => {
    const versions = ['1.0', '2.0', '1.1']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['2.0', '1.1', '1.0'])
  })

  it('should order versions with different number of segments in descending semantic order', () => {
    const versions = ['1.0.1', '2', '1.1']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['2', '1.1', '1.0.1'])
  })

  it('should order versions in descending semantic order when versions begin with "v"', () => {
    const versions = ['v1.0', 'v2.0', 'v1.1']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['v2.0', 'v1.1', 'v1.0'])
  })

  it('should order final version before pre-release versions', () => {
    const versions = ['1.0-alpha.1', '1.0', '1.0-beta.1', '1.0-alpha.2']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['1.0', '1.0-beta.1', '1.0-alpha.2', '1.0-alpha.1'])
  })

  it('should order non-semantic version strings before pre-release versions', () => {
    const versions = ['1.0-alpha.1', 'named', '1.0-beta.1']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['named', '1.0-beta.1', '1.0-alpha.1'])
  })

  it('should not change order of semantic version strings containing non-numbers', () => {
    const versions = ['1.0', '2.x', '2.y', '3.0']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['3.0', '2.x', '2.y', '1.0'])
  })

  it('should order non-semantic version strings before semantic version strings', () => {
    const versionFixtures = [['1.0', 'master'], ['master', '1.0'], ['2.0.1', 'dev'], ['dev', '2.0.1']]
    const expected = [['master', '1.0'], ['master', '1.0'], ['dev', '2.0.1'], ['dev', '2.0.1']]

    versionFixtures.forEach((versions, idx) => {
      versions.sort(versionCompareDesc)
      expect(versions).to.eql(expected[idx])
    })
  })

  it('should order non-semantic versions as strings', () => {
    const versions = ['badger', 'master', 'rev99', 'alligator', 'camel']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['rev99', 'master', 'camel', 'badger', 'alligator'])
  })

  it('should order numbers in descending numeric order', () => {
    const versions = ['10', '9', '8', '80', '90']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['90', '80', '10', '9', '8'])
  })

  it('should order numbers in descending numeric order when numbers begin with "v"', () => {
    const versions = ['v10', 'v9', 'v8', 'v80', 'v90']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['v90', 'v80', 'v10', 'v9', 'v8'])
  })

  it('should order bare major versions and point releases in descending order', () => {
    const versions = ['10', '9.0.1', '8', '80', '90.1', '9.0.2']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['90.1', '80', '10', '9.0.2', '9.0.1', '8'])
  })

  it('should group version "v" with other named versions', () => {
    const versions = ['trusty', 'xenial', 'v', '2.0.1']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['xenial', 'v', 'trusty', '2.0.1'])
  })

  it('should group version "Infinity" with other named versions', () => {
    const versions = ['Ionic', 'Infinity', '2.0.1', 'Icicle']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['Ionic', 'Infinity', 'Icicle', '2.0.1'])
  })

  it('should group named version containing "." with other named versions', () => {
    const versions = ['2.0.1', 'ab.ba', 'xy.yx', 'apple']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['xy.yx', 'apple', 'ab.ba', '2.0.1'])
  })

  it('should ignore case when sorting named versions', () => {
    const versions = ['banana', 'Apple', 'CHERRY', 'APPLE']

    versions.sort(versionCompareDesc)
    expect(versions).to.eql(['CHERRY', 'banana', 'APPLE', 'Apple'])
  })

  it('should help ensure order is maintained on insertion', () => {
    const versions = [{ version: '2.0' }, { version: '1.1' }, { version: '1.0' }]

    let newVersion
    let insertIdx

    newVersion = { version: '3.0' }
    insertIdx = versions.findIndex((candidate) => versionCompareDesc(candidate.version, newVersion.version) > 0)
    expect(insertIdx).to.equal(0)

    newVersion = { version: '1.2' }
    insertIdx = versions.findIndex((candidate) => versionCompareDesc(candidate.version, newVersion.version) > 0)
    expect(insertIdx).to.equal(1)

    newVersion = { version: '0.9' }
    insertIdx = versions.findIndex((candidate) => versionCompareDesc(candidate.version, newVersion.version) > 0)
    expect(insertIdx).to.equal(-1)
  })
})

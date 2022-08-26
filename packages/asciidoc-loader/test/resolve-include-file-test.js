/* eslint-env mocha */
'use strict'

const { expect, mockContentCatalog } = require('@antora/test-harness')

const resolveIncludeFile = require('@antora/asciidoc-loader/include/resolve-include-file')

describe('resolveIncludeFile()', () => {
  it('should be able to resolve include file from content catalog', () => {
    const contentCatalog = mockContentCatalog([
      {
        family: 'page',
        module: 'ROOT',
        relative: 'index.adoc',
        contents: '= The Page',
      },
      {
        family: 'partial',
        module: 'the-module',
        relative: 'the-include.adoc',
        contents: 'include contents',
      },
    ])

    const [file, expectedIncludeFile] = contentCatalog.getFiles()
    const includeFile = resolveIncludeFile('the-module:partial$the-include.adoc', file, {}, contentCatalog)
    expect(includeFile).to.exist()
    expect(includeFile.src).to.equal(expectedIncludeFile.src)
    expect(includeFile.contents).to.equal(expectedIncludeFile.contents.toString())
  })
})

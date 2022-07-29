/* eslint-env mocha */
'use strict'

const { expect, heredoc } = require('@antora/test-harness')
const loadAsciiDoc = require('@antora/asciidoc-loader')
const { extractAsciiDocMetadata } = loadAsciiDoc

describe('extractAsciiDocMetadata()', () => {
  it('should export extractAsciiDocMetadata function', () => {
    expect(extractAsciiDocMetadata).to.be.a('function')
  })

  it('should only extract attributes if document has no header', () => {
    const inputFile = {
      contents: heredoc`
        :foo: bar

        content
      `,
      path: 'modules/module-a/pages/page-a.adoc',
      dirname: 'modules/module-a/pages',
      src: {
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'page-a.adoc',
      },
      pub: {
        url: '/component-a/module-a/page-a.html',
        moduleRootPath: '.',
      },
    }
    const doc = loadAsciiDoc(inputFile)
    const metadata = extractAsciiDocMetadata(doc)
    expect(metadata).to.have.property('attributes')
    expect(metadata.attributes).to.eql(doc.getAttributes())
    expect(metadata.attributes.foo).to.eql('bar')
    expect(metadata).to.not.have.property('doctitle')
    expect(metadata).to.not.have.property('xreftext')
    expect(metadata).to.not.have.property('navtitle')
  })

  it('should only extract doctitle, xreftext, and navtitle attributes if document has header', () => {
    const inputFile = {
      contents: heredoc`
        = Let's Go!
        :navtitle: Get Started
        :foo: bar

        content
      `,
      path: 'modules/module-a/pages/page-a.adoc',
      dirname: 'modules/module-a/pages',
      src: {
        component: 'component-a',
        version: '',
        module: 'module-a',
        family: 'page',
        relative: 'page-a.adoc',
      },
      pub: {
        url: '/component-a/module-a/page-a.html',
        moduleRootPath: '.',
      },
    }
    const doc = loadAsciiDoc(inputFile)
    const metadata = extractAsciiDocMetadata(doc)
    expect(metadata).to.have.property('attributes')
    expect(metadata.attributes).to.eql(doc.getAttributes())
    expect(metadata).to.have.property('doctitle')
    expect(metadata.doctitle).to.equal('Let&#8217;s Go!')
    expect(metadata).to.have.property('xreftext')
    expect(metadata.navtitle).to.equal('Get Started')
    expect(metadata).to.have.property('navtitle')
    expect(metadata.xreftext).to.equal(metadata.doctitle)
  })
})

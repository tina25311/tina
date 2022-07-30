/* eslint-env mocha */
'use strict'

const { expect, spy } = require('@antora/test-harness')

const resolveResource = require('@antora/content-classifier/util/resolve-resource')

describe('resolveResource', () => {
  const mockContentCatalog = (file, component) => ({
    getById: spy(() => file),
    getComponent: spy((name) => component),
  })

  it('should return false if resource ID spec has invalid syntax', () => {
    const contentCatalog = mockContentCatalog()
    expect(resolveResource('component-foo::', contentCatalog)).to.be.false()
    expect(contentCatalog.getById).to.not.have.been.called()
  })

  it('should return false if page ID spec has invalid syntax', () => {
    const contentCatalog = mockContentCatalog()
    expect(resolveResource('component-foo::', contentCatalog, {}, 'page')).to.be.false()
    expect(contentCatalog.getById).to.not.have.been.called()
  })

  it('should return undefined if file not found in catalog', () => {
    const contentCatalog = mockContentCatalog()
    const targetPageIdSpec = '1.2.3@the-component:the-module:no-such-page.adoc'
    const targetPageId = {
      component: 'the-component',
      version: '1.2.3',
      module: 'the-module',
      family: 'page',
      relative: 'no-such-page.adoc',
    }
    const result = resolveResource(targetPageIdSpec, contentCatalog)
    expect(contentCatalog.getById).to.have.been.called.with(targetPageId)
    expect(result).to.be.undefined()
  })

  it('should return false if family is not specified and default family is null', () => {
    const targetFile = {
      src: {
        component: 'the-component',
        version: '1.2.3',
        module: 'the-module',
        family: 'page',
        relative: 'the-page.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile)
    const targetPageIdSpec = '1.2.3@the-component:the-module:the-page.adoc'
    const result = resolveResource(targetPageIdSpec, contentCatalog, undefined, null)
    expect(contentCatalog.getById).to.not.have.been.called()
    expect(result).to.be.false()
  })

  it('should resolve qualified page ID spec to file in catalog', () => {
    const targetFile = {
      src: {
        component: 'the-component',
        version: '1.2.3',
        module: 'the-module',
        family: 'page',
        relative: 'the-page.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile)
    const targetPageIdSpec = '1.2.3@the-component:the-module:the-page.adoc'
    const targetPageId = {
      component: 'the-component',
      version: '1.2.3',
      module: 'the-module',
      family: 'page',
      relative: 'the-page.adoc',
    }
    const result = resolveResource(targetPageIdSpec, contentCatalog)
    expect(contentCatalog.getById).to.have.been.called.with(targetPageId)
    expect(result).to.exist()
  })

  it('should resolve qualified resource ID spec to file in catalog', () => {
    const targetFile = {
      src: {
        component: 'the-component',
        version: '1.2.3',
        module: 'the-module',
        family: 'partial',
        relative: 'glossary.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile)
    const targetPageIdSpec = '1.2.3@the-component:the-module:partial$glossary.adoc'
    const targetPageId = {
      component: 'the-component',
      version: '1.2.3',
      module: 'the-module',
      family: 'partial',
      relative: 'glossary.adoc',
    }
    const result = resolveResource(targetPageIdSpec, contentCatalog)
    expect(contentCatalog.getById).to.have.been.called.with(targetPageId)
    expect(result).to.exist()
  })

  it('should use context to fill in page ID when resolving file in catalog', () => {
    const context = {
      component: 'current-component',
      version: '1.0',
      module: 'current-module',
      family: 'page',
      relative: 'current-page.adoc',
    }
    const targetFile = {
      src: {
        component: 'current-component',
        version: '1.0',
        module: 'current-module',
        family: 'page',
        relative: 'target-page.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile)
    const targetPageIdSpec = 'target-page.adoc'
    const targetPageId = {
      component: 'current-component',
      version: '1.0',
      module: 'current-module',
      family: 'page',
      relative: 'target-page.adoc',
    }
    const result = resolveResource(targetPageIdSpec, contentCatalog, context)
    expect(contentCatalog.getById).to.have.been.called.with(targetPageId)
    expect(result).to.exist()
  })

  it('should use versionless version of component if component is specified with _ version', () => {
    const targetFile = {
      src: {
        component: 'the-component',
        version: '',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile, { latest: { version: '1.0' } })
    const targetPageIdSpec = '_@the-component::the-page.adoc'
    const targetPageId = {
      component: 'the-component',
      version: '',
      module: 'ROOT',
      family: 'page',
      relative: 'the-page.adoc',
    }
    const result = resolveResource(targetPageIdSpec, contentCatalog)
    expect(contentCatalog.getComponent).to.not.have.been.called()
    expect(contentCatalog.getById).to.have.been.called.with(targetPageId)
    expect(result).to.exist()
  })

  it('should use latest version of component if component is specified without a version', () => {
    const targetFile = {
      src: {
        component: 'the-component',
        version: '1.0',
        module: 'ROOT',
        family: 'page',
        relative: 'the-page.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile, { latest: { version: '1.0' } })
    const targetPageIdSpec = 'the-component::the-page.adoc'
    const targetPageId = {
      component: 'the-component',
      version: '1.0',
      module: 'ROOT',
      family: 'page',
      relative: 'the-page.adoc',
    }
    const result = resolveResource(targetPageIdSpec, contentCatalog)
    expect(contentCatalog.getComponent).to.have.been.called.with('the-component')
    expect(contentCatalog.getById).to.have.been.called.with(targetPageId)
    expect(result).to.exist()
  })

  it('should assume ROOT module if module is not specified', () => {
    const context = {
      component: 'current-component',
      version: '1.0',
      family: 'page',
    }
    const targetFile = {
      src: {
        component: 'current-component',
        version: '1.0',
        module: 'ROOT',
        family: 'page',
        relative: 'target-page.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile)
    const targetPageIdSpec = 'target-page.adoc'
    const targetPageId = {
      component: 'current-component',
      version: '1.0',
      module: 'ROOT',
      family: 'page',
      relative: 'target-page.adoc',
    }
    const result = resolveResource(targetPageIdSpec, contentCatalog, context)
    expect(contentCatalog.getById).to.have.been.called.with(targetPageId)
    expect(result).to.exist()
  })

  it('should return undefined if component is unknown and version not specified', () => {
    const contentCatalog = mockContentCatalog()
    const targetPageIdSpec = 'unknown-component::the-page.adoc'
    const result = resolveResource(targetPageIdSpec, contentCatalog)
    expect(contentCatalog.getComponent).to.have.been.called.with('unknown-component')
    expect(contentCatalog.getById).to.not.have.been.called()
    expect(result).to.be.undefined()
  })

  it('should not use family from context if family not specified in spec', () => {
    const targetFile = {
      src: {
        component: 'the-component',
        version: '1.2.3',
        module: 'the-module',
        family: 'partial',
        relative: 'the-partial.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile)
    const targetResourceIdSpec = '1.2.3@the-component:the-module:the-partial.adoc'
    const result = resolveResource(targetResourceIdSpec, contentCatalog)
    expect(contentCatalog.getById).to.have.been.called.with({ ...targetFile.src, family: 'page' })
    expect(result).to.exist()
  })

  it('should return false if spec does not reference permitted family', () => {
    const targetFile = {
      src: {
        component: 'the-component',
        version: '1.2.3',
        module: 'the-module',
        family: 'partial',
        relative: 'glossary.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile)
    const targetPageIdSpec = '1.2.3@the-component:the-module:partial$the-page.adoc'
    const result = resolveResource(targetPageIdSpec, contentCatalog, {}, 'page', ['page'])
    expect(contentCatalog.getById).to.not.have.been.called()
    expect(result).to.be.be.false()
  })

  it('should prefer default family over family from context if family not specified in ID', () => {
    const context = {
      component: 'current-component',
      version: '1.0',
      module: 'current-module',
      family: 'partial',
      relative: 'current-partial.adoc',
    }
    const targetFile = {
      src: {
        component: 'the-component',
        version: '1.2.3',
        module: 'the-module',
        family: 'page',
        relative: 'the-page.adoc',
      },
    }
    const contentCatalog = mockContentCatalog(targetFile)
    const targetPageIdSpec = '1.2.3@the-component:the-module:the-page.adoc'
    const result = resolveResource(targetPageIdSpec, contentCatalog, context, 'page', ['page'])
    expect(contentCatalog.getById).to.have.been.called.with(targetFile.src)
    expect(result).to.exist()
  })
})

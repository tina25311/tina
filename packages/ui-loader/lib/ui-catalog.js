'use strict'

const $files = Symbol('files')

class UiCatalog {
  constructor () {
    this[$files] = new Map()
  }

  getFiles () {
    const accum = []
    for (const filesForType of this[$files].values()) {
      for (const file of filesForType.values()) accum.push(file)
    }
    return accum
  }

  addFile (file) {
    let filesForType = this[$files].get(file.type)
    if (!filesForType) this[$files].set(file.type, (filesForType = new Map()))
    const key = generateKey(file)
    if (filesForType.has(key)) {
      throw new Error('Duplicate file')
    }
    filesForType.set(key, file)
    return file
  }

  findByType (type) {
    const filesForType = this[$files].get(type)
    return filesForType ? [...filesForType.values()] : []
  }
}

/**
 * @deprecated superceded by getFiles(); scheduled to be removed in Antora 4
 */
UiCatalog.prototype.getAll = UiCatalog.prototype.getFiles

function generateKey ({ type, path }) {
  return type + '$' + path
}

module.exports = UiCatalog

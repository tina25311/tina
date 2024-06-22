'use strict'

const cloneableReadable = require('cloneable-readable')
const { isCloneable } = cloneableReadable
const { Readable } = require('stream')
const Vinyl = require('vinyl')

class File extends Vinyl {
  get relative () {
    return this.path
  }
}

class ReadableOutputFileArray extends Readable {
  constructor (array, cloneStreams) {
    super({ objectMode: true })
    this._array = array.map((it) => toOutputFile(it, cloneStreams)).reverse()
  }

  _read (size) {
    const array = this._array
    while (size--) {
      const next = array.pop()
      if (next === undefined) break
      this.push(next)
    }
    if (size > -1) this.push(null)
  }
}

function toOutputFile (file, cloneStreams) {
  const contents = file.contents
  const outputFile = new File({ contents, path: file.out.path, stat: file.stat })
  if (cloneStreams && isStream(contents)) {
    // NOTE: guard in case contents is created on access (needed for @antora/lunr-extension <= 1.0.0-alpha.8)
    const contentsProperty = Object.getOwnPropertyDescriptor(file, 'contents')
    if (!contentsProperty || contentsProperty.writable) {
      const oContents = isCloneable(contents) ? contents : (file.contents = cloneableReadable(contents))
      outputFile.contents = oContents._piped ? oContents.clone() : (oContents._piped = true) && oContents
    }
  }
  return outputFile
}

function isStream (obj) {
  return obj && typeof obj.pipe === 'function'
}

module.exports = ReadableOutputFileArray

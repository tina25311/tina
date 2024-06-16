'use strict'

const { constants: fsc } = require('fs')
const { Readable } = require('stream')

class ZipReadable extends Readable {
  constructor (zipFile) {
    super({ objectMode: true, highWaterMark: 1 })
    if ((this._closeable = (this._zipFile = zipFile).reader.fd != null) && !zipFile.autoClose) {
      throw new Error('ZipReadable requires file-based ZipFile to be initialized with autoClose:true option')
    }
    if (!zipFile.lazyEntries) {
      throw new Error('ZipReadable requires ZipFile to be initialized with lazyEntries:true option')
    }
    this._init()
  }

  _init () {
    const zipFile = this._zipFile
    zipFile
      .on('entry', (entry) => {
        const mode = this.getFileMode(entry)
        if ((mode & fsc.S_IFMT) === fsc.S_IFDIR) return zipFile.readEntry()
        const path_ = entry.fileName
        const isLink = (mode & fsc.S_IFMT) === fsc.S_IFLNK
        const size = entry.uncompressedSize
        const file = { path: path_, stat: { mtime: entry.getLastModDate(), size }, isStream: () => false }
        if (size === 0) {
          file.contents = Buffer.alloc(size)
          this.push(file)
        } else {
          zipFile.openReadStream(entry, (readErr, readStream) => {
            if (readErr) {
              zipFile.close()
              this.emit('error', readErr)
              return
            }
            if (isLink) {
              const buffer = []
              readStream
                .on('data', (chunk) => buffer.push(chunk))
                .on('error', (readStreamErr) => this.emit('error', readStreamErr))
                .on('end', () => {
                  file.symlink = (buffer.length === 1 ? buffer[0] : Buffer.concat(buffer)).toString()
                  this.push(file)
                })
            } else {
              file.contents = readStream
              file.isStream = () => true
              this.push(file)
            }
          })
        }
      })
      .on(this._closeable ? 'close' : 'end', () => zipFile.emittedError || this.push(null))
  }

  _read (_n) {
    this._zipFile.readEntry()
  }

  getFileMode ({ externalFileAttributes }) {
    const attr = externalFileAttributes >> 16 || 33188
    return [448, 56, 7].map((mask) => attr & mask).reduce((a, b) => a + b, attr & fsc.S_IFMT)
  }
}

module.exports = ZipReadable

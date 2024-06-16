'use strict'

/**
 * Pipes the stream of files to the specified Vinyl destination adapter.
 *
 * Pipes a stream of virtual files to the specified Vinyl destination adapter
 * (a stream transform function) and returns a Promise that resolves when the
 * stream ends.
 *
 * @memberof file-publisher
 *
 * @param {Function} dest - A Vinyl destination adapter, preconfigured to
 *   write to a destination (e.g., `require('vinyl-fs').dest('path/to/dir')`).
 * @param {Readable<File>} files - A Readable stream of virtual files to publish.
 * @param {String} resolveEvent - The name of the event the stream emits to signal completion (default: 'end')
 * @returns {Promise} A promise that resolves when the stream has ended.
 */
function publishStream (dest, files, resolveEvent = 'end') {
  return new Promise((resolve, reject) => files.pipe(dest).on('error', reject).on(resolveEvent, resolve))
}

module.exports = publishStream

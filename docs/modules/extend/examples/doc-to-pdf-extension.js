'use strict'

const fsp = require('node:fs/promises')
const ospath = require('node:path')
const { posix: path } = ospath
const { execFile } = require('node:child_process')

module.exports.register = function () {
  this.once('contentClassified', async ({ playbook, contentCatalog }) => {
    const docExtnames = { '.docx': true, '.fodt': true, '.odt': true }
    const filesToConvert = contentCatalog.getFiles().filter(({ src }) => src.family === 'attachment' && docExtnames[src.extname])
    if (!filesToConvert.length) return
    const buildDirBase = ospath.join(playbook.dir, 'build/doc-to-pdf')
    const convertArgs = ['--writer', '--convert-to', 'pdf']
    const convertOpts = { cwd: buildDirBase, windowsHide: true }
    try {
      await fsp.mkdir(buildDirBase, { recursive: true })
      await Promise.all(filesToConvert.map((file) => {
        const sourceRelpath = `${file.src.component}-${file.src.module}-${file.out.basename}`
        convertArgs.push(sourceRelpath)
        return fsp.writeFile(ospath.join(buildDirBase, sourceRelpath), file.contents)
      }))
      await new Promise((resolve, reject) => {
        execFile('libreoffice', convertArgs, convertOpts, (err, stderr, stdout) => {
          if (!err) return resolve()
          const splitIdx = stderr.indexOf('Usage: ')
          if (~splitIdx) stderr = stderr.slice(0, splitIdx).trimEnd()
          if (stderr) err.message += stderr
          reject(err)
        })
      })
      await Promise.all(filesToConvert.map((file) => {
        file.out.path = path.join(file.out.dirname, (file.out.basename = file.out.basename.slice(0, -file.src.extname.length) + '.pdf'))
        file.pub.url = file.pub.url.slice(0, -file.src.extname.length) + '.pdf'
        const sourceRelpath = `${file.src.component}-${file.src.module}-${file.out.basename}`
        return fsp.readFile(ospath.join(buildDirBase, sourceRelpath)).then((contents) => (file.contents = contents))
      }))
    } finally {
      await fsp.rm(buildDirBase, { recursive: true, force: true })
    }
  })
}

'use strict'

const fs = require('node:fs')
const ospath = require('node:path')

module.exports = async (destConfig, filesStream, playbook) => {
  const files = []
  let file
  while ((file = filesStream.read())) files.push(file)
  let destPath = ospath.resolve(playbook.dir || '.', destConfig.path)
  if (fs.existsSync(destPath)) destPath += '.1'
  fs.writeFileSync(destPath, `published ${files.length} files for ${playbook.site.title}`)
}

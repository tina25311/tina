'use strict'

const { promises: fsp } = require('fs')
const README_SRC = 'README.adoc'
const README_HIDDEN = '.' + README_SRC
const README_DEST = 'README.md'

function writeMarkdown (asciidoc) {
  const markdown = asciidoc
    .replace(/^=+(?= \w)/gm, (m) => '#'.repeat(m.length))
    .replace(new RegExp('(https?:[^\\[]+)\\[(|.*?[^\\\\])\\]', 'g'), '[$2]($1)')
  return fsp.writeFile(README_DEST, markdown)
}

function writePackageJson (packageJson) {
  packageJson = packageJson.substr(0, packageJson.lastIndexOf('\n}')) + ',\n  "readmeFilename": "README.md"\n}\n'
  return fsp.writeFile('package.json', packageJson, 'utf8')
}

/**
 * Transforms the AsciiDoc README (README.adoc) in the working directory into
 * Markdown format (README.md) and hides the AsciiDoc README (.README.adoc).
 */
;(async () => {
  const readmeSrc = await fsp.stat(README_SRC).then((stat) => (stat.isFile() ? README_SRC : README_HIDDEN))
  const writeP = fsp.readFile(readmeSrc, 'utf8').then((asciidoc) => writeMarkdown(asciidoc))
  const renameP = readmeSrc === README_SRC ? fsp.rename(README_SRC, README_HIDDEN) : Promise.resolve()
  const setReadmeFilenameP = fsp.readFile('package.json', 'utf8').then((packageJson) => writePackageJson(packageJson))
  await Promise.all([writeP, renameP, setReadmeFilenameP])
})()

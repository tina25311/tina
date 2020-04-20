'use strict'

const { exec } = require('child_process')
const fs = require('fs')
const { promisify } = require('util')
const README_FILE = 'README.adoc'

/**
 * Updates the copyright year in the README (README.adoc) located in the working directory.
 */
;(async () => {
  let now = new Date()
  now = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  await promisify(fs.readFile)(README_FILE, 'utf8')
    .then((contents) => promisify(fs.writeFile)(
      README_FILE,
      contents.replace(/^Copyright \(C\) (\d{4})-\d{4}/m, `Copyright (C) $1-${now.getFullYear()}`)
    ))
    .then(() => promisify(exec)('git add README.adoc'))
})()

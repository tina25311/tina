'use strict'

const vfs = require('vinyl-fs')
const eslint = require('gulp-eslint')

module.exports = (glob) =>
  vfs
    .src(glob)
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(eslint.failAfterError())

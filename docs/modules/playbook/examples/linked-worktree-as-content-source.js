'use strict'

/* Copyright (c) 2022 OpenDevise, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License Version 2.0. If a copy of this license was not distributed
 * with this file, you can obtain one at http://mozilla.org/MPL/2.0/.
 */
const fsp = require('node:fs/promises')
const ospath = require('node:path')

/**
 * Rewrites local content sources to support the use of linked worktrees.
 *
 * @author Dan Allen <dan@opendevise.com>
 */
module.exports.register = function () {
  this.once('playbookBuilt', async ({ playbook }) => {
    const expandPath = this.require('@antora/expand-path-helper')
    for (const contentSource of playbook.content.sources) {
      const { url, branches } = contentSource
      if (url.charAt() !== '.') continue
      const absdir = expandPath(url, { dot: playbook.dir })
      const dotgit = ospath.join(absdir, '.git')
      const dotgitIsFile = await fsp.stat(dotgit).then((stat) => stat.isFile(), () => false)
      if (!dotgitIsFile) continue
      const worktreeGitdir = await fsp.readFile(dotgit, 'utf8').then((contents) => contents.substr(8).trimEnd())
      const worktreeBranch = await fsp
        .readFile(ospath.join(worktreeGitdir, 'HEAD'), 'utf8')
        .then((contents) => contents.trimEnd().replace(/^ref: (?:refs\/heads\/)?/, ''))
      const reldir = ospath.relative(
        playbook.dir,
        await fsp.readFile(ospath.join(worktreeGitdir, 'commondir'), 'utf8').then((contents) => {
          const gitdir = ospath.join(worktreeGitdir, contents.trimEnd())
          return ospath.basename(gitdir) === '.git' ? ospath.dirname(gitdir) : gitdir
        })
      )
      contentSource.url = reldir ? `.${ospath.sep}${reldir}` : '.'
      if (!branches) continue
      contentSource.branches = (branches.constructor === Array ? branches : [branches]).map((pattern) =>
        pattern.replaceAll('HEAD', worktreeBranch)
      )
    }
  })
}

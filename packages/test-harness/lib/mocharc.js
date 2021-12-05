'use strict'

module.exports = Object.assign(
  {
    mochaGlobalTeardown () {
      if (!this.failures) logCoverageReportPath()
    },
    require: __filename,
    spec:
      process.argv[2] ||
      (process.env.npm_package_json === require('path').join(process.env.npm_config_local_prefix, 'package.json')
        ? `packages/${process.env.npm_config_package || '*'}/test/**/*-test.js`
        : 'test/**/*-test.js'),
  },
  process.env.CI
    ? {
        forbidOnly: true,
        reporter: 'dot',
        timeout: process.platform === 'win32' ? '10000' : '5000',
      }
    : {}
)

function logCoverageReportPath () {
  if (!process.env.NYC_PROCESS_ID) return
  const { CI_PROJECT_PATH, CI_JOB_ID } = process.env
  const coverageReportRelpath = 'coverage/lcov-report/index.html'
  const coverageReportPath = CI_JOB_ID
    ? `https://gitlab.com/${CI_PROJECT_PATH}/-/jobs/${CI_JOB_ID}/artifacts/file/${coverageReportRelpath}`
    : require('url').pathToFileURL(coverageReportRelpath)
  console.log(`Coverage report: ${coverageReportPath}`)
}

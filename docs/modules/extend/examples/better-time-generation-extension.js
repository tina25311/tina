module.exports.register = function () {
  this
    .prependListener('playbookBuilt', () => {
      console.time('generation time')
    })
    .on('sitePublished', () => {
      console.timeEnd('generation time')
    })
}

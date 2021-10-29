module.exports.register = function () {
  this
    .on('playbookBuilt', () => {
      console.time('generation time')
    })
    .on('sitePublished', () => {
      console.timeEnd('generation time')
    })
}

module.exports.register = (pipeline) => {
  pipeline
    .on('playbookBuilt', () => {
      console.time('generation time')
    })
    .on('sitePublished', () => {
      console.timeEnd('generation time')
    })
}

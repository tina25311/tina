module.exports.register = (pipeline) => {
  pipeline
    .prependListener('playbookBuilt', () => {
      console.time('generation time')
    })
    .on('sitePublished', () => {
      console.timeEnd('generation time')
    })
}

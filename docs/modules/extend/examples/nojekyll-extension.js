module.exports.register = (pipeline) => {
  pipeline
    .on('beforePublish', ({ siteCatalog }) => {
      siteCatalog.addFile({ contents: Buffer.alloc(0), out: { path: '.nojekyll' } })
    })
}

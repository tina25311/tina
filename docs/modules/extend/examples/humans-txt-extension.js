module.exports.register = (pipeline, { config }) => {
  pipeline.on('beforePublish', ({ siteCatalog }) => {
    const contents = Buffer.from('/* TEAM */\n' + config.names.map((name) => `Name: ${name}`).join('\n') + '\n')
    siteCatalog.addFile({ contents, out: { path: 'humans.txt' } })
  })
}

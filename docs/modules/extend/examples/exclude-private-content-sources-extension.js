module.exports.register = function () {
  this.on('playbookBuilt', function ({ playbook }) {
    const env = playbook.env
    playbook = JSON.parse(JSON.stringify(playbook))
    playbook.content.sources = playbook.content.sources.filter(({ url }) => !url.startsWith('https://git@'))
    playbook.env = env
    this.updateVariables({ playbook })
  })
}

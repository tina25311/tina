'use strict'

module.exports.register = (eventEmitter, config) => {
  eventEmitter.on('beforeBuildPlaybook', ({args, env, schema}) => {
    env.beforeLoaded = 'called'
  })
  eventEmitter.on('afterBuildPlaybook', (playbook) => {
    playbook.afterLoaded = 'called'
    if (config) {
      const configs = playbook.configs || (playbook.configs = [])
      configs.push(config)
    }
  })
}



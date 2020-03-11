
let args

module.exports.isEnabled = function (config, file, contentCatalog) {
  args = { config, file, contentCatalog }
  return false
}

module.exports.retrieve = () => args

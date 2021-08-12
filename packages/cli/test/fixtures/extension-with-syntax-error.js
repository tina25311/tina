'use strict'

module.exports.register = (registry) => {
  registry.treeProcessor(function () {
    this.process((doc) => {
      console.log(doc.getDocumentTitle()
    })
  })
}

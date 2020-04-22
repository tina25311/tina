#!/bin/bash

if [ -z $npm_config_registry ]; then npm_config_registry=http://localhost:4873; fi

# configure npm client for publishing
echo access=public > .npmrc
if [ ! -z $RELEASE_NPM_TOKEN ]; then
  echo ${npm_config_registry#*:}/:_authToken=$RELEASE_NPM_TOKEN >> .npmrc
fi

for package in packages/*; do
  mkdir -p $package/scripts
  for script in prepublish.js postpublish.js; do
    cat << EOF > $package/scripts/$script
require('child_process').execSync('node ../../scripts/$script', { cwd: require('path').resolve(__dirname, '..') })
EOF
  done
done

npm_config_registry=$npm_config_registry lerna publish ${1:-prerelease} --exact --force-publish=*

unlink .npmrc

for package in packages/*; do
  rm -rf $package/scripts
done

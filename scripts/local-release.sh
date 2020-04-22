#!/bin/bash

for package in packages/*; do
  mkdir -p $package/scripts
  for script in prepublish.js postpublish.js; do
    cat << EOF > $package/scripts/$script
require('child_process').execSync('node ../../scripts/$script', { cwd: require('path').resolve(__dirname, '..') })
EOF
  done
done

echo '/packages/*/scripts/' >> .gitignore

npm_config_registry=${npm_config_registry:-http://localhost:4873} lerna publish ${1:-prerelease} --exact --force-publish=*

for package in packages/*; do
  rm -rf $package/scripts
done

git restore .gitignore

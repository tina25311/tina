#!/bin/bash

for package in `find packages -mindepth 1 -maxdepth 1 -printf "%f\n"`; do
  if [ "$(node -p "require('./packages/$package/package.json').private == true")" == 'true' ]; then continue; fi
  npm --registry ${npm_config_registry:-http://localhost:4873} unpublish --force @antora/$package
done

cd ${1:-../test-release-to}
git tag -d `git tag`
git checkout main
git reset --hard `git rev-parse current`
git checkout current

cd -
git tag -d `git tag`
git fetch origin
git reset --hard origin/main

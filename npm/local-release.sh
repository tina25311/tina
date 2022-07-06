#!/bin/bash

if [ -z $npm_config_registry ]; then npm_config_registry=http://localhost:4873; fi

if [ "$1" == "revert" ]; then
  for package in `find packages -mindepth 1 -maxdepth 1 -printf "%f\n"`; do
    if [ "$(node -p "require('./packages/$package/package.json').private == true")" == 'true' ]; then continue; fi
    npm --registry $npm_config_registry unpublish --force $(node -p "require('./packages/$package/package.json').name")
  done

  CURRENT_TAG=`git describe --tags --exact-match 2>/dev/null`
  if [ ! -z $CURRENT_TAG ]; then
    git tag -d $CURRENT_TAG
    RELEASE_BRANCH=`git current-branch`
    git reset --hard `git rev-parse $RELEASE_BRANCH~1`
  fi

  exit 0
fi

# RELEASE_VERSION can be a version number (exact) or increment keyword (next in sequence)
if [ -z $RELEASE_VERSION ]; then RELEASE_VERSION=prerelease; fi
if [ -z $RELEASE_NPM_TAG ]; then
  if case $RELEASE_VERSION in major|minor|patch) ;; *) false;; esac; then
    RELEASE_NPM_TAG=latest
  elif case $RELEASE_VERSION in pre*) ;; *) false;; esac; then
    RELEASE_NPM_TAG=testing
  elif [ "$RELEASE_VERSION" != "${RELEASE_VERSION/-/}" ]; then
    RELEASE_NPM_TAG=testing
  else
    RELEASE_NPM_TAG=latest
  fi
fi

# configure npm client for publishing
echo -e "access=public\ntag=$RELEASE_NPM_TAG\nregistry=$npm_config_registry" > .npmrc

if [ ! -z $RELEASE_NPM_TOKEN ]; then
  echo ${npm_config_registry#*:}/:_authToken=$RELEASE_NPM_TOKEN >> .npmrc
fi

# release!
(
  set -e
  npm version --workspaces --include-workspace-root --no-git-tag-version $RELEASE_VERSION
  RELEASE_VERSION=$(npm exec -c 'echo -n $npm_package_version')
  if case $RELEASE_VERSION in 1.0.0-*) ;; *) false;; esac; then
    sed -i "s/^tag=$RELEASE_NPM_TAG$/tag=latest/" .npmrc
  fi
  git commit -a -m "release $RELEASE_VERSION [skip ci]"
  git tag -m "version $RELEASE_VERSION" v$RELEASE_VERSION
  npm publish $(node npm/publish-workspace-args.js)
)

exit_code=$?

# nuke npm settings
unlink .npmrc

exit $exit_code

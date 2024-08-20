#!/usr/bin/env node --no-warnings=ExperimentalWarning --loader ts-node/esm

const pleaseUpgradeNode = require('please-upgrade-node');

const pkg = require('../package.json');
pleaseUpgradeNode(pkg);

const devMode = require('fs').existsSync(`${__dirname}/../src`);
const forceDist = process.argv.indexOf('--force-dist') >= 0;

if (devMode && !forceDist) {
  const project = require.resolve('../tsconfig.json');
  console.log(__dirname, project);
  require('ts-node').register({ project });

  import('../src/main/codegen.ts').then(({ runCodegen }) => runCodegen());
} else {
  import('../dist/main/codegen.js').then(({ runCodegen }) => runCodegen());
}

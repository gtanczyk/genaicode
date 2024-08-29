#!/usr/bin/env node

const pleaseUpgradeNode = require('please-upgrade-node');

const pkg = require('../package.json');
pleaseUpgradeNode(pkg);

const devMode = require('fs').existsSync(`${__dirname}/../src`);
const forceDist = process.argv.indexOf('--force-dist') >= 0;

if (devMode && !forceDist) {
  pleaseUpgradeNode({
    name: "genaicode-dev.js",
    engines: {
      node: ">=20",
    }, 
  });

  import('./genaicode-dev.js');
} else {
  import('../dist/main/codegen.js').then(({ runCodegen }) => runCodegen());
}

#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-var-requires */
const pleaseUpgradeNode = require('please-upgrade-node');

const pkg = require('../package.json');
pleaseUpgradeNode(pkg);

const devMode = require('fs').existsSync(`${__dirname}/../src`);
const forceDist = process.argv.indexOf('--force-dist') >= 0;

if (devMode && !forceDist) {
  pleaseUpgradeNode({
    name: 'genaicode-dev.js',
    engines: {
      node: '>=20',
    },
  });

  import('./genaicode-dev.js').catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  import('../dist/main/codegen.js').then(({ runCodegen }) => runCodegen()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

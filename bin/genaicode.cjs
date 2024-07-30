#!/usr/bin/env node

const pleaseUpgradeNode = require('please-upgrade-node');

const pkg = require('../package.json');
pleaseUpgradeNode(pkg);

import('../src/main/codegen.js').then(({ runCodegen }) => runCodegen());

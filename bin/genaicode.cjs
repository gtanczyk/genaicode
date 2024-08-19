#!/usr/bin/env node --loader ts-node/esm

const pleaseUpgradeNode = require('please-upgrade-node');

const path = require('path');

const project = path.join(__dirname, '..', 'tsconfig.json');
require('ts-node').register({ project });

const pkg = require('../package.json');
pleaseUpgradeNode(pkg);

import('../src/main/codegen.ts').then(({ runCodegen }) => runCodegen());

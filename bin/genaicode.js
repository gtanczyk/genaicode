#!/usr/bin/env node --loader ts-node/esm

import path from 'path';
import tsNode from 'ts-node';

const project = path.resolve('./tsconfig.json');
tsNode.register({ project });

const codegen = await import('../src/main/codegen.ts');

await codegen.runCodegen();

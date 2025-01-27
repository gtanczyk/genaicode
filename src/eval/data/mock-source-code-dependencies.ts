/**
 * Mock source code examples with various dependency patterns for testing
 * the dependency extraction capabilities of the LLM.
 */

export const MOCK_SOURCE_CODE_DEPENDENCIES = {
  // ESM imports with relative paths
  'esm-relative': [
    {
      path: '/project/src/utils/file-utils.ts',
      content: `import { readFile } from '../fs/read-file.js';
import { writeFile } from '../fs/write-file.js';
import { validatePath } from './path-validator.js';
import type { FileOptions } from './types.js';

export function processFile(path: string, options: FileOptions) {
  validatePath(path);
  const content = readFile(path);
  // Process content
  writeFile(path, content);
}`,
    },
    {
      path: '/project/src/fs/read-file.ts',
      content: `import { readFileSync } from 'fs';
export function readFile(path) {
  return readFileSync(path, 'utf-8');
}`,
    },
    {
      path: '/project/src/fs/write-file.ts',
      content: `import { writeFileSync } from 'fs';
export function writeFile(path, content) {
  writeFileSync(path, content, 'utf-8');
}`,
    },
  ],

  // ESM imports with relative paths but no contents on deps
  'esm-relative-no-contents': [
    {
      path: '/project/src/utils/file-utils.ts',
      content: `import { readFile } from '../fs/read-file.js';
import { writeFile } from '../fs/write-file.js';
import { validatePath } from './path-validator.js';
import type { FileOptions } from './types.js';

export function processFile(path: string, options: FileOptions) {
  validatePath(path);
  const content = readFile(path);
  // Process content
  writeFile(path, content);
}`,
    },
    {
      path: '/project/src/fs/read-file.ts',
      content: null,
    },
    {
      path: '/project/src/fs/write-file.ts',
      content: null,
    },
    {
      path: '/project/src/utils/path-validator.ts',
      content: null,
    },
    {
      path: '/project/src/utils/types.ts',
      content: null,
    },
  ],

  // ESM imports with package names
  'esm-packages': [
    {
      path: '/project/src/services/api-service.ts',
      content: `import axios from 'axios';
import { z } from 'zod';
import type { AxiosResponse } from 'axios';
import { logger } from '@internal/logger';

const responseSchema = z.object({
  data: z.string(),
  timestamp: z.number()
});

export async function fetchData() {
  const response: AxiosResponse = await axios.get('/api/data');
  logger.info('Data fetched successfully');
  return responseSchema.parse(response.data);
}`,
    },
  ],

  // CommonJS require with relative paths
  'commonjs-relative': [
    {
      path: '/project/src/lib/database.js',
      content: `const { connect } = require('../db/connection');
const { Query } = require('./query');
const config = require('../config/database.json');

function initDatabase() {
  const connection = connect(config);
  return new Query(connection);
}

module.exports = { initDatabase };`,
    },
  ],

  // CommonJS require with package names
  'commonjs-packages': [
    {
      path: '/project/src/scripts/build.js',
      content: `const path = require('path');
const fs = require('fs-extra');
const webpack = require('webpack');
const { program } = require('commander');

const config = require('../webpack.config.js');

program
  .option('-m, --mode <mode>', 'build mode')
  .parse(process.argv);

const compiler = webpack(config);
compiler.run((err, stats) => {
  if (err) process.exit(1);
  fs.writeFileSync(
    path.join(__dirname, 'stats.json'),
    JSON.stringify(stats.toJson())
  );
});`,
    },
  ],

  // Mixed ESM and CommonJS in one file
  'mixed-imports': [
    {
      path: '/project/src/utils/mixed-module.ts',
      content: `import path from 'path';
import { readFileSync } from 'fs';
const chalk = require('chalk');
const { glob } = require('glob');
import type { Stats } from 'fs';

// Legacy module that only supports CommonJS
const legacyModule = require('../legacy/old-module');

export async function processFiles(pattern: string) {
  const files = await glob(pattern);
  return files.map(file => {
    const stats: Stats = readFileSync(file);
    console.log(chalk.green(\`Processing \${path.basename(file)}\`));
    return legacyModule.process(stats);
  });
}`,
    },
  ],

  // Edge cases: dynamic imports, type imports, etc.
  'edge-cases': [
    {
      path: '/project/src/features/dynamic-loader.ts',
      content: `import type { Plugin } from './types';
import type { Options } from '@internal/types';

// Type-only import
import type { Configuration } from 'webpack';

// Dynamic imports
async function loadPlugin(name: string): Promise<Plugin> {
  const module = await import(\`./plugins/\${name}\`);
  return module.default;
}

// Side effect import
import './polyfills';

// Import assertions (JSON modules)
import config from './config.json' assert { type: 'json' };

// Require.resolve
const pluginPath = require.resolve('@scope/plugin/path');

// Import with renamed symbols
import { 
  something as somethingElse,
  type SomeType as RenamedType
} from './somewhere';

export { loadPlugin };`,
    },
  ],
};

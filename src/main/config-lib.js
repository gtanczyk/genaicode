import fs from 'fs';
import path from 'path';
import assert from 'node:assert';

import { isAncestorDirectory } from '../files/file-utils.js';

// This file contains project codegen configuration
const CODEGENRC_FILENAME = '.genaicoderc';

// Find .genaicoderc file
export function findRcFile() {
  let rcFilePath = process.cwd();
  while (!fs.existsSync(path.join(rcFilePath, CODEGENRC_FILENAME))) {
    const parentDir = path.dirname(rcFilePath);
    if (parentDir === rcFilePath) {
      throw new Error(`${CODEGENRC_FILENAME} not found in any parent directory`);
    }
    rcFilePath = parentDir;
  }
  return path.join(rcFilePath, CODEGENRC_FILENAME);
}

// Read and parse .genaicoderc file
export function parseRcFile(rcFilePath) {
  assert(fs.existsSync(rcFilePath), `${CODEGENRC_FILENAME} not found`);
  const rcConfig = JSON.parse(fs.readFileSync(rcFilePath, 'utf-8'));
  assert(rcConfig.rootDir, 'Root dir not configured');

  const rootDir = path.resolve(path.dirname(rcFilePath), rcConfig.rootDir);
  assert(isAncestorDirectory(path.dirname(rcFilePath), rootDir), 'Root dir is not located inside project directory');

  return { ...rcConfig, rootDir };
}

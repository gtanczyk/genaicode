import fs from 'fs';
import path from 'path';
import assert from 'node:assert';

// This file contains project codegen configuration
const CODEGENRC_FILENAME = '.genaicoderc';

const cwd = process.cwd();

// Find .genaicoderc file
function findRcFile() {
  let rcFilePath = cwd;
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
function parseRcFile(rcFilePath) {
  assert(fs.existsSync(rcFilePath), `${CODEGENRC_FILENAME} not found`);
  const rcConfig = JSON.parse(fs.readFileSync(rcFilePath, 'utf-8'));
  const rootDir = path.resolve(path.dirname(rcFilePath), rcConfig.rootDir);

  assert(rootDir, 'Root dir not configured');
  assert(isAncestorDirectory(path.dirname(rcFilePath), rootDir), 'Root dir is not located inside project directory');

  return { ...rcConfig, rootDir };
}

// Check if directory is ancestor of given directory
function isAncestorDirectory(parent, dir) {
  const relative = path.relative(parent, dir);
  return parent === dir || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

// Default extensions if not specified in .genaicoderc
const DEFAULT_EXTENSIONS = [
  '.md',
  '.js',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.py',
  '.go',
  '.c',
  '.h',
  '.cpp',
  '.txt',
  '.html',
  '.txt',
  '.json',
];

// A list of paths that are ignored by default
const DEFAULT_IGNORE_PATHS = ['node_modules', 'build', 'dist', 'package-lock.json', 'coverage'];

// Read and parse the configuration
const rcFilePath = findRcFile();
export const rcConfig = parseRcFile(rcFilePath);

// Use extensions from .genaicoderc if available, otherwise use default
export const sourceExtensions = rcConfig.extensions || DEFAULT_EXTENSIONS;

// Image extensions (driven by ai service limitations)
export const IMAGE_ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

// Export ignore paths
export const ignorePaths = rcConfig.ignorePaths ?? DEFAULT_IGNORE_PATHS;

console.log('Detected codegen configuration', rcConfig);
console.log('Root dir:', rcConfig.rootDir);

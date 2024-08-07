import { findRcFile, parseRcFile } from './config-lib.js';

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

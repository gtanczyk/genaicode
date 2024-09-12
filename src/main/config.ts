import { findRcFile, parseRcFile, RcConfig, ImportantContext, ModelOverrides } from './config-lib.js';
import path from 'path';

// Default extensions if not specified in .genaicoderc
const DEFAULT_EXTENSIONS: string[] = [
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
const DEFAULT_IGNORE_PATHS: string[] = ['node_modules', 'build', 'dist', 'package-lock.json', 'coverage'];

// Read and parse the configuration
const rcFilePath: string = findRcFile();
export const rcConfig: RcConfig = parseRcFile(rcFilePath);

// Use extensions from .genaicoderc if available, otherwise use default
export const sourceExtensions: string[] = rcConfig.extensions || DEFAULT_EXTENSIONS;

// Image extensions (driven by ai service limitations)
export const IMAGE_ASSET_EXTENSIONS: string[] = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

// Export ignore paths
export const ignorePaths: string[] = rcConfig.ignorePaths ?? DEFAULT_IGNORE_PATHS;

// Process and export important context
export const importantContext: ImportantContext = processImportantContext(rcConfig.importantContext);

// Export model overrides
export const modelOverrides: ModelOverrides = rcConfig.modelOverrides ?? {};

function processImportantContext(context: ImportantContext | undefined): ImportantContext {
  if (!context) return { textPrompts: [], files: [] };

  return {
    textPrompts: context.textPrompts || [],
    files: (context.files || []).map((file) => path.resolve(rcConfig.rootDir, file)),
  };
}

console.log('Detected codegen configuration', rcConfig);
console.log('Root dir:', rcConfig.rootDir);
console.log('Important context:', importantContext);
console.log('Model overrides:', modelOverrides);

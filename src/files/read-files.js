import fs from 'fs';

import { getSourceFiles } from './find-files.js';

/**
 * Read contents of source files and create a map with file path as key and file content as value
 */
function readSourceFiles() {
  const sourceCode = {};
  for (const file of getSourceFiles()) {
    sourceCode[file] = fs.readFileSync(file, 'utf-8');
  }
  return sourceCode;
}

/** Print source code of all source files */
export function getSourceCode() {
  return readSourceFiles();
}
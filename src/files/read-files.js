import fs from 'fs';

import { getSourceFiles } from './find-files.js';
import { verifySourceCodeLimit } from '../prompt/limits.js';

/**
 * Read contents of source files and create a map with file path as key and file content as value
 */
function readSourceFiles(filterPaths) {
  const sourceCode = {};
  for (const file of getSourceFiles()) {
    if (!filterPaths || filterPaths.includes(file)) {
      sourceCode[file] = fs.readFileSync(file, 'utf-8');
    }
  }
  return sourceCode;
}

/** Print source code of all source files */
export function getSourceCode(filterPaths) {
  const sourceCode = readSourceFiles(filterPaths);
  verifySourceCodeLimit(JSON.stringify(sourceCode));
  return sourceCode;
}

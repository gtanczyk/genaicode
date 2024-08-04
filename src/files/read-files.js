import fs from 'fs';
import mime from 'mime-types';
import sizeOf from 'image-size';

import { getSourceFiles, getImageAssetFiles } from './find-files.js';
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

/** Get image asset files summary */
export function getImageAssets() {
  const imageAssets = {};
  for (const file of getImageAssetFiles()) {
    const dimensions = sizeOf(file);
    imageAssets[file] = {
      mimeType: mime.lookup(file),
      width: dimensions.width,
      height: dimensions.height,
    };
  }
  verifySourceCodeLimit(JSON.stringify(imageAssets));
  return imageAssets;
}

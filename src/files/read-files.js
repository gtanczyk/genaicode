import fs from 'fs';
import mime from 'mime-types';
import sizeOf from 'image-size';
import path from 'path';
import globRegex from 'glob-regex';

import { getSourceFiles, getImageAssetFiles } from './find-files.js';
import { rcConfig } from '../main/config.js';
import { verifySourceCodeLimit } from '../prompt/limits.js';
import { taskFile, contentMask, ignorePatterns } from '../cli/cli-params.js';

/**
 * Read contents of source files and create a map with file path as key and file content as value
 */
function readSourceFiles(filterPaths) {
  const sourceCode = {};
  for (const file of getSourceFiles()) {
    if (!filterPaths || filterPaths.includes(file)) {
      // Apply content mask filter if it's set
      if (!filterPaths && contentMask) {
        const relativePath = path.relative(rcConfig.rootDir, file);
        if (!relativePath.startsWith(contentMask)) {
          sourceCode[file] = { content: null }; // Include the file path but set content to null
          continue;
        }
      }
      if (ignorePatterns.some((pattern) => globRegex(pattern).test(file))) {
        sourceCode[file] = { content: null };
      } else {
        const content = fs.readFileSync(file, 'utf-8');
        sourceCode[file] = { content };
      }
    }
  }
  return sourceCode;
}

/** Print source code of all source files */
export function getSourceCode(filterPaths) {
  const sourceCode = readSourceFiles(filterPaths);

  if (taskFile && !sourceCode[taskFile]) {
    sourceCode[taskFile] = {
      content: fs.readFileSync(taskFile, 'utf-8'),
    };
  }

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

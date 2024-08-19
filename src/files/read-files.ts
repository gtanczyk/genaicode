import fs from 'fs';
import mime from 'mime-types';
import sizeOf from 'image-size';
import path from 'path';
import globRegex from 'glob-regex';

import { getSourceFiles, getImageAssetFiles } from './find-files.ts';
import { rcConfig } from '../main/config.ts';
import { verifySourceCodeLimit } from '../prompt/limits.js';
import { taskFile, contentMask, ignorePatterns } from '../cli/cli-params.ts';

type SourceCodeMap = Record<string, { content: string | null } | undefined>;

type ImageAssetsMap = Record<
  string,
  {
    mimeType: string | false;
    width: number;
    height: number;
  }
>;

/**
 * Read contents of source files and create a map with file path as key and file content as value
 */
function readSourceFiles(filterPaths?: string[]): SourceCodeMap {
  const sourceCode: SourceCodeMap = {};
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
      if (ignorePatterns.some((pattern) => globRegex.default(pattern).test(file))) {
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
export function getSourceCode(filterPaths?: string[]): SourceCodeMap {
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
export function getImageAssets(): ImageAssetsMap {
  const imageAssets: ImageAssetsMap = {};
  for (const file of getImageAssetFiles()) {
    const dimensions = sizeOf.default(file);
    imageAssets[file] = {
      mimeType: mime.lookup(file),
      width: dimensions.width!,
      height: dimensions.height!,
    };
  }
  verifySourceCodeLimit(JSON.stringify(imageAssets));
  return imageAssets;
}

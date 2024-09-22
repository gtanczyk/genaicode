import fs from 'fs';
import mime from 'mime-types';
import sizeOf from 'image-size';
import path from 'path';
import globRegex from 'glob-regex';

import { getSourceFiles, getImageAssetFiles } from './find-files.js';
import { rcConfig, importantContext } from '../main/config.js';
import { CodegenOptions } from '../main/codegen-types.js';
import { verifySourceCodeLimit } from '../prompt/limits.js';

export type SourceCodeMap = Record<string, { content: string | null }>;

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
function readSourceFiles(
  { contentMask, ignorePatterns }: CodegenOptions,
  filterPaths?: string[],
  forceAll = false,
): SourceCodeMap {
  const sourceCode: SourceCodeMap = {};
  const importantFiles = new Set(importantContext.files || []);

  for (const file of getSourceFiles()) {
    if (!filterPaths || filterPaths.includes(file) || importantFiles.has(file)) {
      // Always include important files
      if (importantFiles.has(file)) {
        sourceCode[file] = { content: fs.readFileSync(file, 'utf-8') };
        continue;
      }

      // Apply content mask filter if it's set
      if (!filterPaths && contentMask && !forceAll) {
        const relativePath = path.relative(rcConfig.rootDir, file);
        if (!relativePath.startsWith(contentMask)) {
          sourceCode[file] = { content: null }; // Include the file path but set content to null
          continue;
        }
      }
      if (!forceAll && ignorePatterns?.some((pattern) => globRegex(pattern).test(file))) {
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
export function getSourceCode(
  {
    filterPaths,
    taskFile,
    forceAll,
  }: {
    filterPaths?: string[];
    taskFile?: string | undefined;
    forceAll?: boolean;
  },
  options: CodegenOptions,
): SourceCodeMap {
  const sourceCode = readSourceFiles(options, filterPaths, forceAll);

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
    const dimensions = sizeOf(file);
    imageAssets[file] = {
      mimeType: mime.lookup(file),
      width: dimensions.width!,
      height: dimensions.height!,
    };
  }
  verifySourceCodeLimit(JSON.stringify(imageAssets));
  return imageAssets;
}

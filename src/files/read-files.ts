import fs from 'fs';
import mime from 'mime-types';
import sizeOf from 'image-size';
import path from 'path';
import globRegex from 'glob-regex';

import { getSourceFiles, getImageAssetFiles } from './find-files.js';
import { rcConfig, importantContext } from '../main/config.js';
import { CodegenOptions } from '../main/codegen-types.js';
import { verifySourceCodeLimit } from '../prompt/limits.js';
import { getSummary } from '../prompt/steps/step-summarization.js';

/**
 * Represents a dependency in the source code
 */
export interface DependencyInfo {
  /** Path of the dependeny */
  path: string;
  /** Type of dependency */
  type: 'local' | 'external';
}

/**
 * Represents file content with optional dependencies
 */
export interface FileContent {
  /** The actual content of the file */
  content: string | null;
  /** Optional list of dependencies */
  dependencies?: DependencyInfo[];
}

/**
 * Represents a file summary with optional dependencies
 */
export interface FileSummary {
  /** Summary of the file content */
  summary?: string;
  /** Optional list of dependencies */
  dependencies?: DependencyInfo[];
}

export type SourceCodeMap = Record<string, FileContent | FileSummary>;

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
  ignoreImportantFiles = false,
): SourceCodeMap {
  const sourceCode: SourceCodeMap = {};
  const importantFiles = ignoreImportantFiles ? new Set() : new Set(importantContext.files || []);

  for (const file of getSourceFiles()) {
    if (!fs.existsSync(file)) {
      continue;
    }

    if (!filterPaths || filterPaths.includes(file) || importantFiles.has(file)) {
      const summary = getSummary(file);

      // Always include important files
      if (importantFiles.has(file)) {
        const content = fs.readFileSync(file, 'utf-8');
        sourceCode[file] = {
          content,
          dependencies: summary?.dependencies,
        };
        continue;
      }

      // Apply content mask filter if it's set
      if (!filterPaths && contentMask && !forceAll) {
        const relativePath = path.relative(rcConfig.rootDir, file);
        if (!relativePath.startsWith(contentMask)) {
          sourceCode[file] = summary
            ? {
                summary: summary.summary,
                ...(summary.dependencies?.length ? { dependencies: summary.dependencies } : {}),
              }
            : { content: null };

          continue;
        }
      }

      if (!forceAll) {
        sourceCode[file] =
          !ignorePatterns?.some((pattern) => globRegex(pattern).test(file)) && summary
            ? {
                summary: summary.summary,
                ...(summary.dependencies?.length ? { dependencies: summary.dependencies } : {}),
              }
            : { content: null };
      } else {
        const content = fs.readFileSync(file, 'utf-8');
        sourceCode[file] = {
          content,
          dependencies: summary?.dependencies,
        };
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
    ignoreImportantFiles,
  }: {
    filterPaths?: string[];
    taskFile?: string | undefined;
    forceAll?: boolean;
    ignoreImportantFiles?: boolean;
  },
  options: CodegenOptions,
): SourceCodeMap {
  const sourceCode = readSourceFiles(options, filterPaths, forceAll, ignoreImportantFiles);

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

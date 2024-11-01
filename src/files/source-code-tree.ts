import path from 'path';
import { SourceCodeMap } from '../files/read-files.js';
import { rcConfig } from '../main/config.js';

export type SourceCodeTree = {
  [directoryPath: string]: {
    [filePath: string]: { content: string | null } | { summary: string };
  };
};

export function getSourceCodeTree(sourceCode: SourceCodeMap): SourceCodeTree {
  const result: SourceCodeTree = {};

  for (const [filePath, fileData] of Object.entries(sourceCode)) {
    if (!filePath.startsWith(rcConfig.rootDir)) {
      continue;
    }

    const dirPath = path.dirname(filePath);
    const fileName = path.basename(filePath);
    if (!result[dirPath]) {
      result[dirPath] = {};
    }

    result[dirPath][fileName] = 'content' in fileData ? { content: fileData.content } : { summary: fileData.summary };
  }

  return result;
}

export function parseSourceCodeTree(sourceCodeTree: SourceCodeTree): SourceCodeMap {
  const result: SourceCodeMap = {};

  for (const [dirPath, files] of Object.entries(sourceCodeTree)) {
    for (const [filePath, fileData] of Object.entries(files)) {
      result[`${dirPath}/${filePath}`] = fileData;
    }
  }

  return result;
}

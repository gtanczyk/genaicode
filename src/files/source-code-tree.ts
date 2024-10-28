import path from 'path';
import { SourceCodeMap } from '../files/read-files';
import { rcConfig } from '../main/config';

export type SourceCodeTree = {
  [directoryPath: string]: {
    [filePath: string]: [content: string | null] | [content: null, summary: string];
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

    result[dirPath][fileName] = 'content' in fileData ? [fileData.content] : [null, fileData.summary];
  }

  return result;
}

export function parseSourceCodeTree(sourceCodeTree: SourceCodeTree): SourceCodeMap {
  const result: SourceCodeMap = {};

  for (const [dirPath, files] of Object.entries(sourceCodeTree)) {
    for (const [filePath, fileData] of Object.entries(files)) {
      const [content, summary] = fileData;
      result[`${dirPath}/${filePath}`] = content ? { content } : summary ? { summary } : { content: null };
    }
  }

  return result;
}

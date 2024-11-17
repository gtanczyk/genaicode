import path from 'path';
import { SourceCodeMap, FileContent, FileSummary } from '../files/read-files.js';
import { rcConfig } from '../main/config.js';

/**
 * Type guard to check if an object is a FileContent with dependencies
 */
function hasContent(obj: FileContent | FileSummary): obj is FileContent {
  return 'content' in obj;
}

/**
 * Type guard to check if an object is a FileSummary with dependencies
 */
function hasSummary(obj: FileContent | FileSummary): obj is FileSummary {
  return 'summary' in obj;
}

/**
 * Directory structure representing source code files with their content or summaries and dependencies
 */
export type SourceCodeTree = {
  [directoryPath: string]: {
    [filePath: string]: FileContent | FileSummary;
  };
};

/**
 * Converts flat SourceCodeMap into a directory tree structure
 */
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

    // Handle both content and summary cases while preserving dependencies
    if (hasContent(fileData)) {
      result[dirPath][fileName] = {
        content: fileData.content,
        ...(fileData.dependencies && { dependencies: fileData.dependencies }),
      };
    } else if (hasSummary(fileData)) {
      result[dirPath][fileName] = {
        summary: fileData.summary,
        ...(fileData.dependencies && { dependencies: fileData.dependencies }),
      };
    }
  }

  return result;
}

/**
 * Converts directory tree structure back into flat SourceCodeMap
 */
export function parseSourceCodeTree(sourceCodeTree: SourceCodeTree): SourceCodeMap {
  const result: SourceCodeMap = {};

  for (const [dirPath, files] of Object.entries(sourceCodeTree)) {
    for (const [filePath, fileData] of Object.entries(files)) {
      const fullPath = `${dirPath}/${filePath}`;

      // Handle both content and summary cases while preserving dependencies
      if (hasContent(fileData)) {
        result[fullPath] = {
          content: fileData.content,
          ...(fileData.dependencies && { dependencies: fileData.dependencies }),
        };
      } else if (hasSummary(fileData)) {
        result[fullPath] = {
          summary: fileData.summary,
          ...(fileData.dependencies && { dependencies: fileData.dependencies }),
        };
      }
    }
  }

  return result;
}

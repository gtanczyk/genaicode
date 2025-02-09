import { generateFileId } from './file-id-utils.js';
import { SourceCodeMap } from './source-code-types.js';
import { FileSummary } from './source-code-types.js';
import { FileContent } from './source-code-types.js';

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
type SourceCodeTree = {
  [directoryPath: string]: {
    [filePath: string]: FileContent | FileSummary;
  };
};

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
          fileId: generateFileId(fullPath),
          content: fileData.content,
          ...(fileData.dependencies && { dependencies: fileData.dependencies }),
        };
      } else if (hasSummary(fileData)) {
        result[fullPath] = {
          fileId: generateFileId(fullPath),
          summary: fileData.summary,
          ...(fileData.dependencies && { dependencies: fileData.dependencies }),
        };
      }
    }
  }

  return result;
}

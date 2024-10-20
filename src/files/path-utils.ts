import path from 'path';
import { getSourceFiles } from './find-files.js';
import { rcConfig } from '../main/config.js';
import { isAncestorDirectory } from './file-utils.js';

export function isProjectPath(filePath: string): boolean {
  const sourceFiles = getSourceFiles();

  return (
    isAncestorDirectory(rcConfig.rootDir, filePath) ||
    sourceFiles.includes(filePath) ||
    !sourceFiles.some(
      (sourceFile) =>
        path.dirname(filePath) === path.dirname(sourceFile) ||
        isAncestorDirectory(path.dirname(sourceFile), path.dirname(filePath)),
    )
  );
}

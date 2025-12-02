import { SourceCodeMap, FileSummary, FileContent } from './source-code-types.js';
import { getSourceCode } from './read-files.js';
import { CodegenOptions } from '../main/codegen-types.js';
import { SummaryCache } from './summary-cache.js';

/**
 * Returns a SourceCodeMap containing the content of context files, their first-level dependencies,
 * and files that depend on the context files.
 *
 * @param contextPaths An array of file paths to consider as context.
 * @param options Codegen options to be passed to getSourceCode.
 * @returns A SourceCodeMap containing:
 *   1. All files from contextPaths
 *   2. Their first-level dependencies
 *   3. Files that depend on the context files
 */
export function getContextSourceCode(contextPaths: string[], options: CodegenOptions): SourceCodeMap {
  if (!contextPaths || contextPaths.length === 0) {
    return {};
  }

  const allSourceCodeMap = getSourceCode({ forceAll: true, ignoreImportantFiles: true }, options);
  const resultSourceCodeMap: SourceCodeMap = {};
  const dependencyPaths: Set<string> = new Set();
  const reverseDependencyPaths: Set<string> = new Set();
  const fileIDtoPathMap = getFileIDtoPathMap(allSourceCodeMap);

  // Add context paths and their first-level dependencies
  for (const contextPath of contextPaths) {
    if (allSourceCodeMap[contextPath]) {
      resultSourceCodeMap[contextPath] = allSourceCodeMap[contextPath];
      const localDeps = (allSourceCodeMap[contextPath] as FileContent | FileSummary)?.localDeps;
      if (localDeps) {
        for (const depFileId of localDeps) {
          const depPath = fileIDtoPathMap.get(depFileId);
          if (depPath) {
            dependencyPaths.add(depPath);
          }
        }
      }
    }
  }

  // Add dependency files to the result
  for (const dependencyPath of dependencyPaths) {
    if (allSourceCodeMap[dependencyPath]) {
      resultSourceCodeMap[dependencyPath] = allSourceCodeMap[dependencyPath];
    }
  }

  // Find reverse dependencies
  for (const filePath of Object.keys(allSourceCodeMap)) {
    const fileContent = allSourceCodeMap[filePath] as FileContent | FileSummary;
    const localDeps = fileContent?.localDeps;
    if (localDeps) {
      for (const depFileId of localDeps) {
        const depPath = fileIDtoPathMap.get(depFileId);
        if (depPath && contextPaths.includes(depPath)) {
          reverseDependencyPaths.add(filePath);
          break; // Add the file only once if it depends on any context path
        }
      }
    }
  }

  // Safeguard against large growth of resultSourceCodeMap
  if (reverseDependencyPaths.size > contextPaths.length * 2 + dependencyPaths.size * 2) {
    console.warn(
      'Too many reverse dependencies found, clearing them to prevent excessive growth of resultSourceCodeMap.',
    );
    reverseDependencyPaths.clear();
  }

  // Add reverse dependency files to the result
  for (const reverseDependencyPath of reverseDependencyPaths) {
    if (allSourceCodeMap[reverseDependencyPath]) {
      resultSourceCodeMap[reverseDependencyPath] = allSourceCodeMap[reverseDependencyPath];
    }
  }

  return resultSourceCodeMap;
}

/**
 * Returns an array of file paths that are expanded from the given context paths.
 *
 * @param contextPaths
 * @param options
 * @returns
 */
export function getExpandedContextPaths(contextPaths: string[], options: CodegenOptions): string[] {
  const sourceCodeMap = getContextSourceCode(contextPaths, options);
  // need to make sure original contextPaths values are included in the result
  return [...new Set([...contextPaths, ...Object.keys(sourceCodeMap)])];
}

/**
 * Computes a set of popular dependencies from the summary cache.
 * @param summaryCache The cache containing summaries and dependencies.
 * @param threshold The minimum number of times a file must be depended on to be considered popular.
 * @returns A Set of file paths for popular dependencies.
 */
export function computePopularDependencies(
  sourceCode: SourceCodeMap,
  summaryCache: SummaryCache,
  threshold = 25,
): Set<string> {
  const dependencyCounts = new Map<string, number>();

  const fileIDtoPathMap = getFileIDtoPathMap(sourceCode);

  // Count occurrences of each dependency
  for (const key in summaryCache) {
    if (key === '_version') continue;
    const fileInfo = summaryCache[key];
    if (fileInfo.localDeps) {
      for (const depFileId of fileInfo.localDeps) {
        const depPath = fileIDtoPathMap.get(depFileId);
        if (depPath) {
          dependencyCounts.set(depPath, (dependencyCounts.get(depPath) || 0) + 1);
        }
      }
    }
  }

  const popular = new Set<string>();
  const sortedDeps = [...dependencyCounts.entries()].sort((a, b) => b[1] - a[1]);

  for (const [filePath, count] of sortedDeps) {
    if (count >= threshold) {
      popular.add(filePath);
    } else {
      break; // Stop if we hit a dependency below the threshold
    }
  }

  return popular;
}

export function getFileIDtoPathMap(sourceCode: SourceCodeMap): Map<number, string> {
  const fileIDtoPathMap: Map<number, string> = new Map();
  for (const [filePath, fileData] of Object.entries(sourceCode)) {
    if (fileData.fileId) {
      fileIDtoPathMap.set(fileData.fileId, filePath);
    }
  }
  return fileIDtoPathMap;
}

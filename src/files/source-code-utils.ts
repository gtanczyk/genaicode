import { SourceCodeMap, FileSummary, FileContent } from './source-code-types.js';
import { getSourceCode } from './read-files.js';
import { CodegenOptions } from '../main/codegen-types.js';

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

  // Add context paths and their first-level dependencies
  for (const contextPath of contextPaths) {
    if (allSourceCodeMap[contextPath]) {
      resultSourceCodeMap[contextPath] = allSourceCodeMap[contextPath];
      const dependencies = (allSourceCodeMap[contextPath] as FileContent | FileSummary)?.dependencies;
      if (dependencies) {
        dependencies.forEach((dep) => dependencyPaths.add(dep.path));
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
    const dependencies = fileContent?.dependencies;
    if (dependencies) {
      for (const dep of dependencies) {
        if (contextPaths.includes(dep.path)) {
          reverseDependencyPaths.add(filePath);
          break; // Add the file only once if it depends on any context path
        }
      }
    }
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
  return Object.keys(sourceCodeMap);
}

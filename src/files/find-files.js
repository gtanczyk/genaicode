import fs from 'fs';
import path from 'path';
import { rcConfig, sourceExtensions, IMAGE_ASSET_EXTENSIONS, ignorePaths } from '../main/config.js';

// List of possible extensions for dependency resolution
const POSSIBLE_DEPENDENCY_EXTENSIONS = ['.ts', '.js', '.tsx', '.jsx'];

function findFiles(dir, recursive, extensions) {
  const files = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);

    if (ignorePaths.some((ignorePath) => fullPath.endsWith(ignorePath))) {
      continue;
    }

    if (fs.statSync(fullPath).isDirectory()) {
      if (recursive) {
        files.push(...findFiles(fullPath, true, extensions));
      }
    } else if (extensions.includes(path.extname(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

function getDependencies(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const dependencyRegex = /import\s+.+?\s+from\s+['"](.+?\/?[^'"]+)['"]/g;
  const dependencies = [];
  let match;
  while ((match = dependencyRegex.exec(content)) !== null) {
    const dependencyPath = match[1];
    // Resolve relative paths from the file's directory
    let resolvedPath = path.resolve(path.dirname(filePath), dependencyPath);

    // Only add the dependency if it's a local file and not a module
    if (fs.existsSync(resolvedPath)) {
      dependencies.push(resolvedPath);
    } else {
      const possibleExtensions = POSSIBLE_DEPENDENCY_EXTENSIONS;
      for (const ext of possibleExtensions) {
        const extendedPath = resolvedPath + ext;
        if (fs.existsSync(extendedPath)) {
          dependencies.push(extendedPath);
        }
      }
    }
  }
  return dependencies;
}

/** Generates a dependency list for given file */
export function getDependencyList(entryFile) {
  const visitedFiles = new Set();
  const result = new Set();

  function traverse(file) {
    if (visitedFiles.has(file)) return;
    visitedFiles.add(file);
    const dependencies = getDependencies(file);
    dependencies.forEach((dependency) => result.add(dependency));
    dependencies.forEach(traverse);
  }

  result.add(path.resolve(entryFile));
  traverse(entryFile);

  return Array.from(result);
}

const sourceFiles = findFiles(rcConfig.rootDir, true, sourceExtensions);

/** Get source files of the application */
export function getSourceFiles() {
  return [...sourceFiles];
}

const imageAssetFiles = findFiles(rcConfig.rootDir, true, IMAGE_ASSET_EXTENSIONS);

/** Get source files of the application */
export function getImageAssetFiles() {
  return [...imageAssetFiles];
}

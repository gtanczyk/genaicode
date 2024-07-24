import fs from 'fs';
import path from 'path';

// This file contains project codegen configuration
const CODEGENRC_FILENAME = '.codegenrc';

const cwd = process.cwd();

// Find .codegenrc file
let rcFilePath = cwd;
while (!fs.existsSync(path.join(rcFilePath, CODEGENRC_FILENAME))) {
  const parentDir = path.dirname(rcFilePath);
  if (parentDir === rcFilePath) {
    throw new Error(`${CODEGENRC_FILENAME} not found in any parent directory`);
  }
  rcFilePath = parentDir;
}
rcFilePath = path.join(rcFilePath, CODEGENRC_FILENAME);

// Read rootDir from .codegenrc
const rcConfig = JSON.parse(fs.readFileSync(rcFilePath, 'utf-8'));
const rootDir = path.resolve(path.dirname(rcFilePath), rcConfig.rootDir);

console.log('Detected codegen configuration', rcConfig);
console.log('Root dir:', rootDir);

function findFiles(dir, recursive, ...exts) {
  const files = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (item === 'node_modules' || item === 'build') {
      continue;
    }

    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      if (recursive) {
        files.push(...findFiles(fullPath, true, ...exts));
      }
    } else if (exts.includes(path.extname(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

function getDependencies(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const dependencyRegex = /import\s+.+?\s+from\s+['"](.+?)['"]/g;
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
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        if (fs.existsSync(resolvedPath + '.ts')) {
          dependencies.push(resolvedPath + '.ts');
        }
        if (fs.existsSync(resolvedPath + '.tsx')) {
          dependencies.push(resolvedPath + '.tsx');
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

const rootFiles = findFiles(rootDir, true, '.md', '.js', '.ts', '.tsx', '.css');

/** Get source files of the application */
export function getSourceFiles() {
  return [...rootFiles];
}

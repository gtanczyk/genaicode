import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import * as diff from 'diff';

import { isAncestorDirectory, getSourceFiles, rootDir } from './find-files.js';
import {
  allowDirectoryCreate,
  allowFileCreate,
  allowFileDelete,
  allowFileMove,
  anthropic,
  chatGpt,
  vertexAiClaude,
} from '../cli/cli-params.js';

/**
 * @param functionCalls Result of the code generation, a map of file paths to new content
 */
export function updateFiles(functionCalls) {
  for (const { name, args } of functionCalls) {
    let { filePath, newContent, source, destination, patch } = args;

    // Check if filePath is absolute, if not use rootDir as baseline
    if (name !== 'moveFile') {
      filePath = path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
    } else {
      source = path.isAbsolute(source) ? source : path.join(rootDir, source);
      destination = path.isAbsolute(destination) ? destination : path.join(rootDir, destination);
    }

    // ignore files which are not located inside project directory (sourceFiles)
    if (
      (name !== 'moveFile' && !isProjectPath(filePath)) ||
      (name === 'moveFile' && (!isProjectPath(source) || !isProjectPath(destination)))
    ) {
      console.log(`Skipping file: ${filePath || source}`);
      throw new Error(`File ${filePath || source} is not located inside project directory, something is wrong?`);
    }

    if (name === 'deleteFile') {
      assert(allowFileDelete, 'File delete option was not enabled');
      console.log(`Removing file: ${filePath}`);
      fs.unlinkSync(filePath);
    } else if (name === 'createDirectory') {
      assert(allowDirectoryCreate, 'Directory create option was not enabled');
      console.log(`Creating directory: ${filePath}`);
      fs.mkdirSync(filePath, { recursive: true });
    } else if (name === 'updateFile' || name === 'createFile' || name === 'patchFile') {
      if (name === 'patchFile') {
        console.log(`Applying a patch: ${filePath} content`);
        newContent = diff.applyPatch(fs.readFileSync(filePath, 'utf-8'), patch);
        assert(!!newContent, 'Patch was not successful');
      }

      assert(!!newContent, 'newContent must not be empty');
      if (name === 'createFile') {
        console.log(`Creating file: ${filePath}`);
        assert(allowFileCreate, 'File create option was not enabled');
        assert(!fs.existsSync(filePath), 'File already exists');
        if (allowDirectoryCreate) {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
        }
      } else {
        console.log(`Updating file: ${filePath}`);
        assert(fs.existsSync(filePath), 'File does not exist');
      }
      fs.writeFileSync(
        filePath,
        chatGpt || anthropic || vertexAiClaude
          ? newContent
          : // Fixing a problem caused by vertex function calling. Possibly not a good fix
            newContent.replace(/\\n/g, '\n').replace(/\\'/g, "'"),
        'utf-8',
      );
    } else if (name === 'moveFile') {
      console.log(`Moving file from ${source} to ${destination}`);
      assert(fs.existsSync(source), 'Source file does not exist');
      assert(!fs.existsSync(destination), 'Destination file already exists');
      assert(allowFileMove, 'File move option was not enabled');
      if (allowDirectoryCreate) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
      }
      fs.renameSync(source, destination);
    }
  }
}

function isProjectPath(filePath) {
  const sourceFiles = getSourceFiles();

  return (
    isAncestorDirectory(rootDir, filePath) ||
    sourceFiles.includes(filePath) ||
    !sourceFiles.some(
      (sourceFile) =>
        path.dirname(filePath) === path.dirname(sourceFile) ||
        isAncestorDirectory(path.dirname(sourceFile), path.dirname(filePath)),
    )
  );
}

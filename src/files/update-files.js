import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import * as diff from 'diff';

import { getSourceFiles } from './find-files.js';
import {
  allowDirectoryCreate,
  allowFileCreate,
  allowFileDelete,
  allowFileMove,
  anthropic,
  chatGpt,
} from '../cli/cli-params.js';

/**
 * @param functionCalls Result of the code generation, a map of file paths to new content
 */
export function updateFiles(functionCalls) {
  for (const { name, args } of functionCalls) {
    let { filePath, newContent, source, destination, patch } = args;

    // ignore files which are not located inside project directory (sourceFiles)
    if (
      (name !== 'moveFile' && !isProjectPath(filePath)) ||
      (name == 'moveFile' && !(isProjectPath(source) || isProjectPath(destination)))
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
      fs.mkdirSync(filePath);
    } else if (name === 'updateFile' || name === 'createFile' || name === 'updateFilePartial') {
      if (name === 'updateFilePartial') {
        console.log(`Applying a patch: ${filePath} content`);
        newContent = applyPatch(fs.readFileSync(filePath, 'utf-8'), patch);
        assert(!!newContent, 'Patch was not successful');
      }

      assert(!!newContent, 'newContent must not be empty');
      if (name === 'createFile') {
        console.log(`Creating file: ${filePath}`);
        assert(allowFileCreate, 'File create option was not enabled');
        assert(!fs.existsSync(filePath), 'File already exists');
      } else {
        console.log(`Updating file: ${filePath}`);
        assert(fs.existsSync(filePath), 'File does not exist');
      }
      fs.writeFileSync(
        filePath,
        chatGpt || anthropic
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
      fs.renameSync(source, destination);
    }
  }
}

function isAncestorDirectory(parent, dir) {
  const relative = path.relative(parent, dir);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isProjectPath(filePath) {
  const sourceFiles = getSourceFiles();

  return (
    sourceFiles.includes(filePath) ||
    !sourceFiles.some(
      (sourceFile) =>
        path.dirname(filePath) === path.dirname(sourceFile) ||
        isAncestorDirectory(path.dirname(sourceFile), path.dirname(filePath)),
    )
  );
}

function applyPatch(original, patch) {
  return diff.applyPatch(original, patch);
}

import fs from 'fs';
import path from 'path';
import assert from 'node:assert';

import { isAncestorDirectory } from '../files/file-utils.js';

// This file contains project codegen configuration
const CODEGENRC_FILENAME = '.genaicoderc';

export interface TextPrompt {
  content: string;
}

export interface ImportantContext {
  textPrompts?: TextPrompt[];
  files?: string[];
}

export interface ModelOverrides {
  chatGpt?: {
    cheap?: string;
    default?: string;
  };
  anthropic?: {
    cheap?: string;
    default?: string;
  };
  vertexAi?: {
    cheap?: string;
    default?: string;
  };
  aiStudio?: {
    cheap?: string;
    default?: string;
  };
}

export interface RcConfig {
  rootDir: string;
  lintCommand?: string;
  extensions?: string[];
  ignorePaths?: string[];
  importantContext?: ImportantContext;
  modelOverrides?: ModelOverrides;
}

// Find .genaicoderc file
export function findRcFile(): string {
  let rcFilePath = process.cwd();
  while (!fs.existsSync(path.join(rcFilePath, CODEGENRC_FILENAME))) {
    const parentDir = path.dirname(rcFilePath);
    if (parentDir === rcFilePath) {
      throw new Error(`${CODEGENRC_FILENAME} not found in any parent directory`);
    }
    rcFilePath = parentDir;
  }
  return path.join(rcFilePath, CODEGENRC_FILENAME);
}

// Read and parse .genaicoderc file
export function parseRcFile(rcFilePath: string): RcConfig {
  assert(fs.existsSync(rcFilePath), `${CODEGENRC_FILENAME} not found`);
  const rcConfig: RcConfig = JSON.parse(fs.readFileSync(rcFilePath, 'utf-8'));
  assert(rcConfig.rootDir, 'Root dir not configured');

  const rootDir = path.resolve(path.dirname(rcFilePath), rcConfig.rootDir);
  assert(isAncestorDirectory(path.dirname(rcFilePath), rootDir), 'Root dir is not located inside project directory');

  return { ...rcConfig, rootDir };
}

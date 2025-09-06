import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { confirm } from '@inquirer/prompts';
import os from 'os';

import { isAncestorDirectory } from '../files/file-utils.js';
import { detectAndConfigureProfile, npmProfile } from '../project-profiles/index.js';
import { RcConfig } from './config-types.js';
import { validateRcConfig } from './config-schema.js';

// This file contains project codegen configuration
export const CODEGENRC_FILENAME = '.genaicoderc';

/**
 * Create initial .genaicoderc content with profile detection
 */
async function createInitialConfig(rcFilePath: string): Promise<RcConfig> {
  const rootDir = path.dirname(rcFilePath);
  const detectionResult = await detectAndConfigureProfile(rootDir);
  const profile = detectionResult.profile ?? npmProfile;

  // Create config using detected profile or npm profile as fallback
  const config: RcConfig = {
    rootDir: '.',
    extensions: profile.extensions,
    ignorePaths: profile.ignorePaths,
    ...(profile.lintCommand ? { lintCommand: profile.lintCommand } : {}),
  };

  return config;
}

// Find .genaicoderc file
export async function findRcFile(): Promise<string> {
  let rcFilePath = process.cwd();

  // Check if we're in help mode - provide fallback config
  const isHelpMode = process.argv.includes('--help');

  if (isHelpMode) {
    // For help mode, create a temporary minimal config in memory
    // This avoids the interactive prompts when just showing help
    const tempConfigPath = path.join(os.tmpdir(), '.genaicoderc-help');
    const minimalConfig = {
      rootDir: process.cwd(),
      extensions: ['.ts', '.js', '.tsx', '.jsx'],
      ignorePaths: ['node_modules', 'dist'],
    };
    fs.writeFileSync(tempConfigPath, JSON.stringify(minimalConfig, null, 2));
    return tempConfigPath;
  }

  while (!fs.existsSync(path.join(rcFilePath, CODEGENRC_FILENAME))) {
    const parentDir = path.dirname(rcFilePath);
    if (parentDir === rcFilePath) {
      // We've reached the root directory, .genaicoderc not found,
      // so lets ask the user to create one in the current directory
      const isInteractiveSession = process.stdout.isTTY;
      const isTestMode = process.env.NODE_ENV === 'test';

      // Special handling for test mode - create a temporary config instead of prompting
      if (isTestMode && !isInteractiveSession) {
        const tempConfigPath = path.join(os.tmpdir(), `.genaicoderc-test-${Date.now()}`);
        const testConfig = {
          rootDir: process.cwd(),
          extensions: ['.ts', '.js', '.tsx', '.jsx'],
          ignorePaths: ['node_modules', 'dist'],
        };
        fs.writeFileSync(tempConfigPath, JSON.stringify(testConfig, null, 2));
        return tempConfigPath;
      }

      // If it's an interactive session, ask to create the config file.
      if (isInteractiveSession) {
        rcFilePath = process.cwd();
        const createRcFile = await confirm({
          message: `${CODEGENRC_FILENAME} not found in any parent directory, would you like to create one in the current directory (${rcFilePath})?`,
          default: false,
        });
        if (createRcFile) {
          const config = await createInitialConfig(path.join(rcFilePath, CODEGENRC_FILENAME));
          fs.writeFileSync(path.join(rcFilePath, CODEGENRC_FILENAME), JSON.stringify(config, null, 2));
          console.log(`Created ${CODEGENRC_FILENAME} in ${rcFilePath} with detected project profile`);
          return path.join(rcFilePath, CODEGENRC_FILENAME);
        }
      }
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
  validateRcConfig(rcConfig);

  assert(rcConfig.rootDir, 'Root dir not configured');

  const rootDir = path.resolve(path.dirname(rcFilePath), rcConfig.rootDir);
  assert(isAncestorDirectory(path.dirname(rcFilePath), rootDir), 'Root dir is not located inside project directory');

  // Validate content using json schema

  // Validate plugins array if it exists
  if (rcConfig.plugins) {
    assert(Array.isArray(rcConfig.plugins), 'Plugins must be an array of strings');
    rcConfig.plugins.forEach((plugin, index) => {
      assert(typeof plugin === 'string', `Plugin at index ${index} must be a string`);
    });
  }

  return { ...rcConfig, rootDir };
}

import fs from 'fs';
import path from 'path';
import assert from 'node:assert';
import { confirm } from '@inquirer/prompts';
import { loadConfig } from 'c12';

import { isAncestorDirectory } from '../files/file-utils.js';
import { detectAndConfigureProfile, npmProfile } from '../project-profiles/index.js';
import { RcConfig } from './config-types.js';
import { validateRcConfig } from './config-schema.js';

const DEFAULT_CONFIG_FILENAME = '.genaicoderc';

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

/**
 * Loads and parses the GenAIcode configuration using the c12 library.
 * It searches for genaicode.config.{ts,js,mjs,cjs,json} or .genaicoderc files.
 * If no configuration is found, it interactively prompts the user to create one.
 *
 * @returns A promise that resolves to the loaded configuration and its file path.
 * @throws An error if no configuration is found and the session is not interactive or the user declines creation.
 */
export async function loadConfiguration(): Promise<{ rcConfig: RcConfig; configFilePath: string }> {
  const result = await loadConfig<RcConfig>({
    name: 'genaicode',
    cwd: process.cwd(),
    packageJson: false,
    globalRc: false,
    rcFile: false,
    // optional: keep default config discovery too by returning undefined when .rc is absent
    resolve: async (_, { cwd }) => {
      if (!cwd) return;
      const p = path.join(cwd, '.genaicoderc');
      if (!fs.existsSync(p)) return; // fall back to c12’s normal discovery
      const txt = fs.readFileSync(p, 'utf-8');
      return { config: JSON.parse(txt), configFile: p };
    },
  });

  if (result) {
    const rcConfig = result.config;
    const configFilePath = result.configFile;

    if (!configFilePath) {
      throw new Error('Could not determine configuration file path from c12 result.');
    }

    validateRcConfig(rcConfig);
    assert(rcConfig.rootDir, 'Root dir not configured');

    const rootDir = path.resolve(path.dirname(configFilePath), rcConfig.rootDir);
    assert(
      isAncestorDirectory(path.dirname(configFilePath), rootDir),
      'Root dir is not located inside project directory',
    );

    if (rcConfig.plugins) {
      assert(Array.isArray(rcConfig.plugins), 'Plugins must be an array of strings');
      rcConfig.plugins.forEach((plugin, index) => {
        assert(typeof plugin === 'string', `Plugin at index ${index} must be a string`);
      });
    }

    return { rcConfig: { ...rcConfig, rootDir }, configFilePath };
  }

  // No config found, handle interactive creation
  const isInteractiveSession =
    process.stdout.isTTY || process.argv.includes('--interactive') || process.argv.includes('--ui');

  if (isInteractiveSession) {
    const creationDir = process.cwd();
    const createRcFile = await confirm({
      message: `No GenAIcode config found. Would you like to create a default ${DEFAULT_CONFIG_FILENAME} in the current directory (${creationDir})?`,
      default: false,
    });

    if (createRcFile) {
      const newConfigPath = path.join(creationDir, DEFAULT_CONFIG_FILENAME);
      const config = await createInitialConfig(newConfigPath);
      fs.writeFileSync(newConfigPath, JSON.stringify(config, null, 2));
      console.log(`Created ${DEFAULT_CONFIG_FILENAME} in ${creationDir} with detected project profile`);

      const resolvedRootDir = path.resolve(path.dirname(newConfigPath), config.rootDir);
      return { rcConfig: { ...config, rootDir: resolvedRootDir }, configFilePath: newConfigPath };
    }
  }

  throw new Error('No GenAIcode config found in any parent directory.');
}

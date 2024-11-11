/**
 * NPM/Node.js Project Profile
 *
 * This profile serves as the base for JavaScript/Node.js projects and
 * can be extended by more specific framework profiles (React, Vue, etc.).
 */

import path from 'path';
import fs from 'fs';
import {
  ProjectProfile,
  PROJECT_FILE_PATTERNS,
  DETECTION_WEIGHTS,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE_PATHS,
} from '../types.js';
import { profileUtils } from '../detection.js';

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Read and parse package.json
 */
async function readPackageJson(rootDir: string): Promise<PackageJson | null> {
  try {
    const packageJsonPath = path.join(rootDir, 'package.json');
    const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Find the best lint command from package.json scripts
 */
async function detectLintCommand(rootDir: string): Promise<string | undefined> {
  const packageJson = await readPackageJson(rootDir);
  if (!packageJson?.scripts) return undefined;

  // Common lint script names in order of preference
  const lintScriptNames = ['lint:fix', 'lint:all', 'lint', 'eslint:fix', 'eslint', 'tslint:fix', 'tslint'];

  // Find the first matching lint script
  const lintScript = lintScriptNames.find((scriptName) => packageJson.scripts?.[scriptName]);
  return lintScript ? `npm run ${lintScript}` : undefined;
}

/**
 * Detect if this is a TypeScript project
 */
async function isTypeScriptProject(rootDir: string, packageJson?: PackageJson | null): Promise<boolean> {
  // Check for TypeScript configuration files
  const tsConfigExists = await profileUtils.anyFileExists(rootDir, ['tsconfig.json', 'tsconfig.base.json']);
  if (tsConfigExists) return true;

  // Check for TypeScript dependencies
  if (packageJson) {
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    return 'typescript' in allDeps;
  }

  return false;
}

/**
 * Get appropriate extensions based on project configuration
 */
async function getProjectExtensions(rootDir: string): Promise<string[]> {
  const packageJson = await readPackageJson(rootDir);
  const isTS = await isTypeScriptProject(rootDir, packageJson);

  const extensions: string[] = [...DEFAULT_EXTENSIONS.JS];

  // Add TypeScript extensions if detected
  if (isTS) {
    extensions.push('.ts', '.tsx', '.d.ts');
  }

  return extensions;
}

/**
 * NPM/Node.js project profile
 */
export const npmProfile: ProjectProfile = {
  id: 'javascript-npm',
  name: 'JavaScript/NPM',
  extensions: [...DEFAULT_EXTENSIONS.JS],
  ignorePaths: [...DEFAULT_IGNORE_PATHS.JS],
  detectionWeight: DETECTION_WEIGHTS.BASE.JS_NPM,

  /**
   * Detect if this is an NPM/Node.js project
   */
  async detect(rootDir: string): Promise<boolean> {
    // Check for package.json
    const hasPackageJson = await profileUtils.fileExists(rootDir, PROJECT_FILE_PATTERNS.JS.NPM);
    if (!hasPackageJson) return false;

    // Check for npm/yarn/pnpm lock files
    const hasLockFile = await profileUtils.anyFileExists(rootDir, ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

    // Also check node_modules to confirm it's an active project
    const hasNodeModules = await profileUtils.fileExists(rootDir, 'node_modules');

    // Consider it an npm project if it has package.json and either a lock file or node_modules
    return hasPackageJson && (hasLockFile || hasNodeModules);
  },

  /**
   * Initialize the profile with project-specific settings
   */
  async initialize(rootDir: string): Promise<void> {
    // Detect and set appropriate extensions
    this.extensions = await getProjectExtensions(rootDir);

    // Detect and set lint command
    this.lintCommand = await detectLintCommand(rootDir);

    // Add project-specific ignore paths
    const extraIgnorePaths = [];

    // Check for Next.js
    if (await profileUtils.fileExists(rootDir, '.next')) {
      extraIgnorePaths.push('.next');
    }

    // Check for Gatsby
    if (await profileUtils.fileExists(rootDir, '.cache')) {
      extraIgnorePaths.push('.cache', 'public');
    }

    // Update ignore paths
    this.ignorePaths = [...DEFAULT_IGNORE_PATHS.JS, ...extraIgnorePaths];
  },
};

// Export utility functions for use in other profiles
export const npmUtils = {
  readPackageJson,
  detectLintCommand,
  isTypeScriptProject,
  getProjectExtensions,
};

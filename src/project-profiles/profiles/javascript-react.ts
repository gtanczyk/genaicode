/**
 * React Project Profile
 *
 * This profile extends the base NPM profile with React-specific configurations
 * and detection logic. It supports various React project types including:
 * - Create React App
 * - Next.js
 * - Vite + React
 * - Custom React setups
 */

import path from 'path';
import { ProjectProfile, PROJECT_FILE_PATTERNS, DETECTION_WEIGHTS, DEFAULT_IGNORE_PATHS } from '../types.js';
import { profileUtils } from '../detection.js';
import { npmProfile, npmUtils } from './javascript-npm.js';

/**
 * Different types of React projects we can detect
 */
const REACT_PROJECT_TYPES = {
  CRA: 'create-react-app',
  NEXT: 'next.js',
  VITE: 'vite',
  CUSTOM: 'custom',
} as const;

type ReactProjectType = (typeof REACT_PROJECT_TYPES)[keyof typeof REACT_PROJECT_TYPES];

/**
 * Configuration files specific to different React setups
 */
const REACT_CONFIG_FILES = {
  CRA: {
    CONFIG: 'react-scripts.json',
    TEMPLATE: 'template.json',
  },
  NEXT: {
    CONFIG: 'next.config.js',
    CONFIG_TS: 'next.config.ts',
  },
  VITE: {
    CONFIG: 'vite.config.js',
    CONFIG_TS: 'vite.config.ts',
  },
} as const;

/**
 * Detect specific React project type
 */
async function detectReactProjectType(rootDir: string): Promise<{ type: ReactProjectType; weight: number }> {
  const packageJson = await npmUtils.readPackageJson(rootDir);
  if (!packageJson) {
    return { type: REACT_PROJECT_TYPES.CUSTOM, weight: 0 };
  }

  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

  // Check for Next.js
  if (
    'next' in allDeps ||
    (await profileUtils.anyFileExists(rootDir, [REACT_CONFIG_FILES.NEXT.CONFIG, REACT_CONFIG_FILES.NEXT.CONFIG_TS]))
  ) {
    return { type: REACT_PROJECT_TYPES.NEXT, weight: DETECTION_WEIGHTS.FRAMEWORK.NEXT };
  }

  // Check for Create React App
  if ('react-scripts' in allDeps || (await profileUtils.fileExists(rootDir, REACT_CONFIG_FILES.CRA.CONFIG))) {
    return { type: REACT_PROJECT_TYPES.CRA, weight: DETECTION_WEIGHTS.FRAMEWORK.REACT };
  }

  // Check for Vite
  if (
    'vite' in allDeps ||
    (await profileUtils.anyFileExists(rootDir, [REACT_CONFIG_FILES.VITE.CONFIG, REACT_CONFIG_FILES.VITE.CONFIG_TS]))
  ) {
    return { type: REACT_PROJECT_TYPES.VITE, weight: DETECTION_WEIGHTS.FRAMEWORK.REACT };
  }

  // Custom React setup
  return { type: REACT_PROJECT_TYPES.CUSTOM, weight: DETECTION_WEIGHTS.FRAMEWORK.REACT };
}

/**
 * Get React-specific file extensions
 */
async function getReactExtensions(rootDir: string): Promise<string[]> {
  const baseExtensions = await npmUtils.getProjectExtensions(rootDir);
  const isTypeScript = await npmUtils.isTypeScriptProject(rootDir);

  // Add React-specific extensions
  const reactExtensions = isTypeScript ? ['.tsx', '.jsx'] : ['.jsx'];

  // Add CSS/SCSS extensions commonly used in React projects
  const styleExtensions = ['.css', '.scss', '.sass', '.less', '.module.css', '.module.scss'];

  return [...new Set([...baseExtensions, ...reactExtensions, ...styleExtensions])];
}

/**
 * Get React-specific ignore paths
 */
async function getReactIgnorePaths(projectType: ReactProjectType): Promise<string[]> {
  const baseIgnorePaths = [...DEFAULT_IGNORE_PATHS.JS];

  switch (projectType) {
    case REACT_PROJECT_TYPES.NEXT:
      return [...baseIgnorePaths, '.next', '.vercel'];
    case REACT_PROJECT_TYPES.CRA:
      return [...baseIgnorePaths, 'build', 'coverage'];
    case REACT_PROJECT_TYPES.VITE:
      return [...baseIgnorePaths, 'dist', '.vite'];
    default:
      return baseIgnorePaths;
  }
}

/**
 * React project profile
 */
export const reactProfile: ProjectProfile = {
  id: 'javascript-react',
  name: 'React',
  extensions: [...npmProfile.extensions],
  ignorePaths: [...npmProfile.ignorePaths],
  detectionWeight: DETECTION_WEIGHTS.FRAMEWORK.REACT,

  /**
   * Detect if this is a React project
   */
  async detect(rootDir: string): Promise<boolean> {
    // First check if it's an npm project
    const isNpmProject = await npmProfile.detect(rootDir);
    if (!isNpmProject) return false;

    const packageJson = await npmUtils.readPackageJson(rootDir);
    if (!packageJson) return false;

    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Check for React dependency
    if (!('react' in allDeps)) return false;

    // Check for React component files
    const hasReactComponents = await profileUtils.anyFileExists(rootDir, [
      ...PROJECT_FILE_PATTERNS.JS.REACT.map((file) => path.join('src', file)),
      ...PROJECT_FILE_PATTERNS.JS.REACT,
    ]);

    return hasReactComponents;
  },

  /**
   * Initialize React-specific configuration
   */
  async initialize(rootDir: string): Promise<void> {
    // Detect React project type
    const { type: projectType } = await detectReactProjectType(rootDir);

    // Set React-specific extensions
    this.extensions = await getReactExtensions(rootDir);

    // Set React-specific ignore paths
    this.ignorePaths = await getReactIgnorePaths(projectType);

    // Try to get lint command from package.json
    this.lintCommand = await npmUtils.detectLintCommand(rootDir);

    console.log(`Initialized React profile (${projectType})`);
  },
};

// Export utilities for other profiles that might extend React
export const reactUtils = {
  detectReactProjectType,
  getReactExtensions,
  getReactIgnorePaths,
};

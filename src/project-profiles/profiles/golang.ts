/**
 * Go Project Profile
 *
 * This profile handles Go projects, supporting both single module
 * and workspace configurations. It includes detection for common
 * Go frameworks and tools.
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

/**
 * Different types of Go projects we can detect
 */
const GO_PROJECT_TYPES = {
  WORKSPACE: 'workspace',
  MODULE: 'module',
  FRAMEWORK: {
    GIN: 'gin',
    ECHO: 'echo',
    CHI: 'chi',
    FIBER: 'fiber',
  },
} as const;

type GoProjectType =
  | typeof GO_PROJECT_TYPES.WORKSPACE
  | typeof GO_PROJECT_TYPES.MODULE
  | (typeof GO_PROJECT_TYPES.FRAMEWORK)[keyof typeof GO_PROJECT_TYPES.FRAMEWORK];

/**
 * Common Go framework imports that help identify project type
 */
const GO_FRAMEWORK_IMPORTS = {
  [GO_PROJECT_TYPES.FRAMEWORK.GIN]: 'github.com/gin-gonic/gin',
  [GO_PROJECT_TYPES.FRAMEWORK.ECHO]: 'github.com/labstack/echo/v4',
  [GO_PROJECT_TYPES.FRAMEWORK.CHI]: 'github.com/go-chi/chi/v5',
  [GO_PROJECT_TYPES.FRAMEWORK.FIBER]: 'github.com/gofiber/fiber/v2',
} as const;

/**
 * Parse go.mod file to extract module information
 */
async function parseGoMod(filePath: string): Promise<{ module: string; requires: string[] } | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const module = lines
      .find((line) => line.trim().startsWith('module'))
      ?.split(' ')[1]
      ?.trim();
    const requires = lines
      .filter((line) => line.trim().startsWith('require'))
      .map((line) => line.split(' ')[1]?.trim())
      .filter(Boolean);

    return module ? { module, requires } : null;
  } catch {
    return null;
  }
}

/**
 * Parse go.work file to extract workspace information
 */
async function parseGoWork(filePath: string): Promise<string[] | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    return lines
      .filter((line) => line.trim().startsWith('use'))
      .map((line) => line.split(' ')[1]?.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Detect specific Go project type
 */
async function detectGoProjectType(rootDir: string): Promise<{ type: GoProjectType; weight: number }> {
  // Check for workspace first
  if (await profileUtils.fileExists(rootDir, PROJECT_FILE_PATTERNS.GO.WORK)) {
    console.log('Detected Go workspace project');
    return { type: GO_PROJECT_TYPES.WORKSPACE, weight: DETECTION_WEIGHTS.BASE.GO_BASE + 1 };
  }

  // Check for module and framework
  const modPath = path.join(rootDir, PROJECT_FILE_PATTERNS.GO.MOD);
  const goMod = await parseGoMod(modPath);

  if (goMod?.requires) {
    // Check for known frameworks
    for (const [framework, importPath] of Object.entries(GO_FRAMEWORK_IMPORTS)) {
      if (goMod.requires.some((req) => req.startsWith(importPath))) {
        console.log(`Detected Go ${framework} project`);
        return { type: framework as GoProjectType, weight: DETECTION_WEIGHTS.FRAMEWORK.REACT };
      }
    }
  }

  console.log('Detected Go module project');
  return { type: GO_PROJECT_TYPES.MODULE, weight: DETECTION_WEIGHTS.BASE.GO_BASE };
}

/**
 * Check for golangci-lint configuration
 */
async function hasGolangciLint(rootDir: string): Promise<boolean> {
  return profileUtils.anyFileExists(rootDir, ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json']);
}

/**
 * Get appropriate lint command based on project configuration
 */
async function detectLintCommand(rootDir: string): Promise<string | undefined> {
  // Check if golangci-lint is configured
  if (await hasGolangciLint(rootDir)) {
    return 'golangci-lint run';
  }

  // Fallback to basic Go linting
  return 'go vet ./...';
}

/**
 * Get Go-specific ignore paths based on project type
 */
async function getGoIgnorePaths(projectType: GoProjectType): Promise<string[]> {
  const baseIgnorePaths: string[] = [...DEFAULT_IGNORE_PATHS.GO];

  // Add common test and build artifacts
  baseIgnorePaths.push('*.test', 'coverage.out', 'coverage.html', 'cpu.out', 'mem.out');

  if (projectType === GO_PROJECT_TYPES.WORKSPACE) {
    // For workspaces, include all potential build directories
    baseIgnorePaths.push('**/bin', '**/dist');
  }

  return baseIgnorePaths;
}

/**
 * Go project profile
 */
export const golangProfile: ProjectProfile = {
  id: 'golang',
  name: 'Go',
  extensions: [...DEFAULT_EXTENSIONS.GO],
  ignorePaths: [...DEFAULT_IGNORE_PATHS.GO],
  detectionWeight: DETECTION_WEIGHTS.BASE.GO_BASE,

  /**
   * Detect if this is a Go project
   */
  async detect(rootDir: string): Promise<boolean> {
    try {
      // Check for go.mod or go.work
      const hasGoFiles = await profileUtils.anyFileExists(rootDir, [
        PROJECT_FILE_PATTERNS.GO.MOD,
        PROJECT_FILE_PATTERNS.GO.WORK,
      ]);

      if (!hasGoFiles) {
        console.log('No Go files (go.mod/go.work) found');
        return false;
      }

      console.log('Found Go files (go.mod/go.work)');

      // For workspace projects, check recursively
      const isWorkspace = await profileUtils.fileExists(rootDir, PROJECT_FILE_PATTERNS.GO.WORK);
      if (isWorkspace) {
        console.log('Checking workspace modules recursively for source files');
        const hasSourceFiles = await profileUtils.anyFileExistsRecursively(
          rootDir,
          ['main.go', 'go.sum'],
          [...DEFAULT_IGNORE_PATHS.GO],
        );
        console.log('Workspace source files found:', hasSourceFiles);
        return hasSourceFiles;
      }

      // For regular modules, check in the root directory
      console.log('Checking root directory for source files');
      const hasSourceFiles = await profileUtils.anyFileExists(rootDir, ['main.go', 'go.sum']);
      console.log('Root directory source files found:', hasSourceFiles);
      return hasSourceFiles;
    } catch (error) {
      console.error('Error during Go project detection:', error);
      return false;
    }
  },

  /**
   * Initialize Go-specific configuration
   */
  async initialize(rootDir: string): Promise<void> {
    try {
      // Detect Go project type
      const { type: projectType } = await detectGoProjectType(rootDir);
      console.log(`Initializing Go profile (${projectType})`);

      // Set Go-specific ignore paths
      this.ignorePaths = await getGoIgnorePaths(projectType);

      // Set appropriate lint command
      this.lintCommand = await detectLintCommand(rootDir);

      // Add .go and .mod files to extensions
      this.extensions = [...DEFAULT_EXTENSIONS.GO];

      // For workspaces, add additional extensions
      if (projectType === GO_PROJECT_TYPES.WORKSPACE) {
        this.extensions.push('.work');
      }

      console.log('Go profile initialization completed:', {
        type: projectType,
        extensions: this.extensions,
        ignorePaths: this.ignorePaths,
        lintCommand: this.lintCommand,
      });
    } catch (error) {
      console.error('Error during Go profile initialization:', error);
      throw error;
    }
  },
};

// Export utilities for other profiles that might extend Go
export const goUtils = {
  parseGoMod,
  parseGoWork,
  detectGoProjectType,
  hasGolangciLint,
  detectLintCommand,
  getGoIgnorePaths,
};

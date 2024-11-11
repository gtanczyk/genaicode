/**
 * Django Project Profile
 *
 * This profile handles Django web applications, supporting both
 * traditional Django projects and Django REST framework applications.
 * It includes detection for common Django patterns and tools.
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
 * Different types of Django projects we can detect
 */
const DJANGO_PROJECT_TYPES = {
  STANDARD: 'standard',
  DRF: 'rest-framework',
  CHANNELS: 'channels',
  WAGTAIL: 'wagtail',
} as const;

type DjangoProjectType = (typeof DJANGO_PROJECT_TYPES)[keyof typeof DJANGO_PROJECT_TYPES];

/**
 * Parse requirements.txt or pyproject.toml to extract dependencies
 */
async function parsePythonDependencies(rootDir: string): Promise<string[]> {
  const dependencies: string[] = [];

  // Try reading requirements.txt
  try {
    const requirementsPath = path.join(rootDir, PROJECT_FILE_PATTERNS.PYTHON.REQUIREMENTS);
    const content = await fs.promises.readFile(requirementsPath, 'utf-8');
    dependencies.push(
      ...content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.split('==')[0].split('>=')[0].trim()),
    );
  } catch {
    // Requirements.txt not found, try pyproject.toml
    try {
      const pyprojectPath = path.join(rootDir, PROJECT_FILE_PATTERNS.PYTHON.POETRY);
      const content = await fs.promises.readFile(pyprojectPath, 'utf-8');

      // Basic TOML parsing for dependencies
      const dependencySection = content.split('[tool.poetry.dependencies]')[1]?.split('[')[0];
      if (dependencySection) {
        dependencies.push(
          ...dependencySection
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => line.split('=')[0].trim()),
        );
      }
    } catch {
      // Neither file found
    }
  }

  return dependencies;
}

/**
 * Check if manage.py is a Django management script
 */
async function isDjangoManagePy(filePath: string): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content.includes('django.core.management');
  } catch {
    return false;
  }
}

/**
 * Detect specific Django project type
 */
async function detectDjangoProjectType(rootDir: string): Promise<{ type: DjangoProjectType; weight: number }> {
  const dependencies = await parsePythonDependencies(rootDir);

  // Check for DRF (Django REST framework)
  if (dependencies.some((dep) => dep === 'djangorestframework')) {
    return { type: DJANGO_PROJECT_TYPES.DRF, weight: DETECTION_WEIGHTS.FRAMEWORK.DJANGO + 1 };
  }

  // Check for Django Channels
  if (dependencies.some((dep) => dep === 'channels')) {
    return { type: DJANGO_PROJECT_TYPES.CHANNELS, weight: DETECTION_WEIGHTS.FRAMEWORK.DJANGO + 1 };
  }

  // Check for Wagtail CMS
  if (dependencies.some((dep) => dep === 'wagtail')) {
    return { type: DJANGO_PROJECT_TYPES.WAGTAIL, weight: DETECTION_WEIGHTS.FRAMEWORK.DJANGO + 1 };
  }

  return { type: DJANGO_PROJECT_TYPES.STANDARD, weight: DETECTION_WEIGHTS.FRAMEWORK.DJANGO };
}

/**
 * Detect virtual environment location
 */
async function detectVirtualEnv(rootDir: string): Promise<string | null> {
  const commonVenvPaths = ['venv', '.venv', 'env', '.env'];

  for (const venvPath of commonVenvPaths) {
    const fullPath = path.join(rootDir, venvPath);
    const activatePath = path.join(fullPath, 'bin', 'activate');

    if ((await profileUtils.fileExists(rootDir, fullPath)) && (await profileUtils.fileExists(rootDir, activatePath))) {
      return venvPath;
    }
  }

  return null;
}

/**
 * Get appropriate lint command based on project configuration
 */
async function detectLintCommand(rootDir: string): Promise<string | undefined> {
  const dependencies = await parsePythonDependencies(rootDir);
  const venvPath = await detectVirtualEnv(rootDir);
  const venvPrefix = venvPath ? `source ${venvPath}/bin/activate && ` : '';

  // Check for various linting tools in order of preference
  if (dependencies.includes('ruff')) {
    return `${venvPrefix}ruff check .`;
  }
  if (dependencies.includes('pylint-django')) {
    return `${venvPrefix}pylint --load-plugins pylint_django **/*.py`;
  }
  if (dependencies.includes('pylint')) {
    return `${venvPrefix}pylint **/*.py`;
  }
  if (dependencies.includes('flake8')) {
    return `${venvPrefix}flake8 .`;
  }

  // Default to Django's built-in checks
  return `${venvPrefix}python manage.py check --deploy`;
}

/**
 * Get Django-specific ignore paths
 */
async function getDjangoIgnorePaths(rootDir: string, projectType: DjangoProjectType): Promise<string[]> {
  const baseIgnorePaths: string[] = [...DEFAULT_IGNORE_PATHS.PYTHON];

  // Add Django-specific paths
  baseIgnorePaths.push('static', 'media', 'staticfiles', '*.sqlite3', 'local_settings.py');

  // Add virtual environment if detected
  const venvPath = await detectVirtualEnv(rootDir);
  if (venvPath) {
    baseIgnorePaths.push(venvPath);
  }

  // Add project type specific paths
  switch (projectType) {
    case DJANGO_PROJECT_TYPES.WAGTAIL:
      baseIgnorePaths.push('media/images', 'media/documents');
      break;
    case DJANGO_PROJECT_TYPES.CHANNELS:
      baseIgnorePaths.push('dumps');
      break;
  }

  return baseIgnorePaths;
}

/**
 * Django project profile
 */
export const djangoProfile: ProjectProfile = {
  id: 'python-django',
  name: 'Django',
  extensions: [...DEFAULT_EXTENSIONS.PYTHON],
  ignorePaths: [...DEFAULT_IGNORE_PATHS.PYTHON],
  detectionWeight: DETECTION_WEIGHTS.FRAMEWORK.DJANGO,

  /**
   * Detect if this is a Django project
   */
  async detect(rootDir: string): Promise<boolean> {
    // Check for manage.py
    const managePyPath = path.join(rootDir, PROJECT_FILE_PATTERNS.PYTHON.DJANGO);
    const hasManagePy = await profileUtils.fileExists(rootDir, managePyPath);

    if (!hasManagePy) return false;

    // Verify it's a Django manage.py
    const isDjango = await isDjangoManagePy(managePyPath);
    if (!isDjango) return false;

    // Check for Django in dependencies
    const dependencies = await parsePythonDependencies(rootDir);
    return dependencies.includes('django');
  },

  /**
   * Initialize Django-specific configuration
   */
  async initialize(rootDir: string): Promise<void> {
    // Detect Django project type
    const { type: projectType } = await detectDjangoProjectType(rootDir);

    // Set Django-specific ignore paths
    this.ignorePaths = await getDjangoIgnorePaths(rootDir, projectType);

    // Set appropriate lint command
    this.lintCommand = await detectLintCommand(rootDir);

    // Add Python extensions
    this.extensions = [...DEFAULT_EXTENSIONS.PYTHON];

    // Add template extensions
    this.extensions.push('.html', '.jinja', '.jinja2');

    console.log(`Initialized Django profile (${projectType})`);
  },
};

// Export utilities for other profiles that might extend Django
export const djangoUtils = {
  parsePythonDependencies,
  isDjangoManagePy,
  detectDjangoProjectType,
  detectVirtualEnv,
  detectLintCommand,
  getDjangoIgnorePaths,
};

/**
 * Core types for the project profiles system.
 * This module contains all the type definitions needed for project type detection,
 * configuration, and plugin integration.
 */

/**
 * Represents a project profile with its configuration and detection logic.
 */
export interface ProjectProfile {
  /** Unique identifier for the profile */
  id: string;

  /** Display name for the profile */
  name: string;

  /** File extensions this profile should consider */
  extensions: string[];

  /** Paths that should be ignored */
  ignorePaths: string[];

  /** Default lint command for this project type */
  lintCommand?: string;

  /**
   * Weight for detection priority. Higher weights indicate more specific profiles.
   * Default profiles use weights 1-10.
   * Plugin profiles should use weights > 10 to override defaults.
   */
  detectionWeight: number;

  /**
   * Async function to detect if this profile matches the project.
   * Should return true if the profile matches, false otherwise.
   */
  detect: (rootDir: string) => Promise<boolean>;

  /** Optional initialization function called when profile is selected */
  initialize?: (rootDir: string) => Promise<void>;
}

/**
 * Result of project profile detection
 */
export interface ProfileDetectionResult {
  /** The detected profile, if any */
  profile: ProjectProfile | null;

  /** Weight of the detection match */
  weight: number;

  /** Any additional metadata from detection */
  metadata?: Record<string, unknown>;
}

/**
 * Plugin interface for project profiles
 */
export interface ProjectProfilePlugin {
  /** Array of profiles provided by this plugin */
  profiles: ProjectProfile[];
}

/**
 * Common project file patterns used for detection
 */
export const PROJECT_FILE_PATTERNS = {
  /** JavaScript/TypeScript patterns */
  JS: {
    NPM: 'package.json',
    YARN: 'yarn.lock',
    PNPM: 'pnpm-lock.yaml',
    REACT: ['src/App.tsx', 'src/App.jsx', 'src/app.tsx', 'src/app.jsx'],
    NEXT: 'next.config.js',
    VITE: 'vite.config.ts',
  },
  /** Java patterns */
  JAVA: {
    MAVEN: 'pom.xml',
    GRADLE: 'build.gradle',
    SPRING: 'application.properties',
  },
  /** Python patterns */
  PYTHON: {
    DJANGO: 'manage.py',
    FLASK: ['app.py', 'wsgi.py'],
    REQUIREMENTS: 'requirements.txt',
    POETRY: 'pyproject.toml',
  },
  /** Go patterns */
  GO: {
    MOD: 'go.mod',
    WORK: 'go.work',
  },
} as const;

/**
 * Detection weights for different profile types
 */
export const DETECTION_WEIGHTS = {
  /** Base framework weights */
  BASE: {
    JS_NPM: 1,
    JAVA_BASE: 1,
    PYTHON_BASE: 1,
    GO_BASE: 1,
  },
  /** Framework-specific weights */
  FRAMEWORK: {
    REACT: 2,
    NEXT: 3,
    SPRING: 2,
    DJANGO: 2,
  },
  /** Plugin weights should be > 10 */
  PLUGIN_MIN_WEIGHT: 10,
} as const;

/**
 * Default extensions for common project types
 */
export const DEFAULT_EXTENSIONS = {
  JS: ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.mts', '.cjs', '.json', '.md', '.css', '.scss', '.html', '.txt'],
  JAVA: ['.java', '.xml', '.properties', '.md', '.txt'],
  PYTHON: ['.py', '.pyi', '.pyw', '.md', '.txt'],
  GO: ['.go', '.mod', '.sum', '.md', '.txt'],
} as const;

/**
 * Default ignore paths for common project types
 */
export const DEFAULT_IGNORE_PATHS = {
  JS: ['node_modules', 'build', 'dist', 'coverage', '.next', '.cache'],
  JAVA: ['target', 'build', 'out', '.gradle', '.mvn', '.settings'],
  PYTHON: ['__pycache__', '*.pyc', '.pytest_cache', 'venv', '.venv', 'dist'],
  GO: ['vendor', 'bin', 'dist'],
} as const;

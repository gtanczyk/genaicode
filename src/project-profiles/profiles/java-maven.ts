/**
 * Java/Maven Project Profile
 *
 * This profile handles Java projects using Maven as the build system.
 * It includes support for:
 * - Standard Maven projects
 * - Spring Boot applications
 * - Jakarta EE applications
 * - Maven multi-module projects
 */

import path from 'path';
import fs from 'fs';
import { parseStringPromise } from 'xml2js';
import {
  ProjectProfile,
  PROJECT_FILE_PATTERNS,
  DETECTION_WEIGHTS,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE_PATHS,
} from '../types.js';
import { profileUtils } from '../detection.js';

/**
 * Different types of Java/Maven projects we can detect
 */
const MAVEN_PROJECT_TYPES = {
  SPRING_BOOT: 'spring-boot',
  JAKARTA_EE: 'jakarta-ee',
  MULTI_MODULE: 'multi-module',
  STANDARD: 'standard',
} as const;

type MavenProjectType = (typeof MAVEN_PROJECT_TYPES)[keyof typeof MAVEN_PROJECT_TYPES];

interface MavenPom {
  project?: {
    packaging?: string[];
    modules?: { module: string[] }[];
    parent?: { groupId: string[]; artifactId: string[] }[];
    dependencies?: {
      dependency: {
        groupId: string[];
        artifactId: string[];
      }[];
    }[];
    properties?: Record<string, string[]>[];
  };
}

/**
 * Read and parse pom.xml file
 */
async function readPomXml(pomPath: string): Promise<MavenPom | null> {
  try {
    const content = await fs.promises.readFile(pomPath, 'utf-8');
    return await parseStringPromise(content);
  } catch {
    return null;
  }
}

/**
 * Detect specific Maven project type
 */
async function detectMavenProjectType(rootDir: string): Promise<{ type: MavenProjectType; weight: number }> {
  const pomPath = path.join(rootDir, PROJECT_FILE_PATTERNS.JAVA.MAVEN);
  const pom = await readPomXml(pomPath);
  if (!pom?.project) {
    return { type: MAVEN_PROJECT_TYPES.STANDARD, weight: DETECTION_WEIGHTS.BASE.JAVA_BASE };
  }

  // Check for multi-module project
  if ((pom.project?.modules?.[0]?.module?.length ?? 0) > 0) {
    return { type: MAVEN_PROJECT_TYPES.MULTI_MODULE, weight: DETECTION_WEIGHTS.FRAMEWORK.SPRING };
  }

  // Check dependencies for project type
  const dependencies = pom.project.dependencies?.[0]?.dependency ?? [];
  const hasSpringBoot = dependencies.some(
    (dep) =>
      dep.groupId[0] === 'org.springframework.boot' ||
      pom.project?.parent?.[0]?.groupId[0] === 'org.springframework.boot',
  );

  if (hasSpringBoot) {
    return { type: MAVEN_PROJECT_TYPES.SPRING_BOOT, weight: DETECTION_WEIGHTS.FRAMEWORK.SPRING };
  }

  const hasJakarta = dependencies.some(
    (dep) => dep.groupId[0].startsWith('jakarta.') || dep.groupId[0].startsWith('javax.'),
  );

  if (hasJakarta) {
    return { type: MAVEN_PROJECT_TYPES.JAKARTA_EE, weight: DETECTION_WEIGHTS.FRAMEWORK.SPRING };
  }

  return { type: MAVEN_PROJECT_TYPES.STANDARD, weight: DETECTION_WEIGHTS.BASE.JAVA_BASE };
}

/**
 * Check for Maven wrapper and return appropriate maven command
 */
async function getMavenCommand(rootDir: string): Promise<string> {
  const hasWrapper = await profileUtils.anyFileExists(rootDir, ['mvnw', 'mvnw.cmd']);

  return hasWrapper ? './mvnw' : 'mvn';
}

/**
 * Get appropriate lint command based on project configuration
 */
async function detectLintCommand(rootDir: string): Promise<string | undefined> {
  const mvnCmd = await getMavenCommand(rootDir);

  // Check for checkstyle plugin in pom.xml
  const pomPath = path.join(rootDir, PROJECT_FILE_PATTERNS.JAVA.MAVEN);
  const pom = await readPomXml(pomPath);

  if (!pom?.project) return undefined;

  // Look for checkstyle plugin in build plugins
  const hasCheckstyle = pom.project.properties?.[0]?.['checkstyle.version'] !== undefined;
  if (hasCheckstyle) {
    return `${mvnCmd} checkstyle:check`;
  }

  // Default lint command for Maven projects
  return `${mvnCmd} verify -DskipTests`;
}

/**
 * Get Java project specific extensions
 */
async function getJavaExtensions(rootDir: string): Promise<string[]> {
  const baseExtensions: string[] = [...DEFAULT_EXTENSIONS.JAVA];

  // Check for Kotlin support
  const pomPath = path.join(rootDir, PROJECT_FILE_PATTERNS.JAVA.MAVEN);
  const pom = await readPomXml(pomPath);

  if (pom?.project?.properties?.[0]?.['kotlin.version']) {
    baseExtensions.push('.kt', '.kts');
  }

  // Check for Scala support
  if (pom?.project?.properties?.[0]?.['scala.version']) {
    baseExtensions.push('.scala');
  }

  return baseExtensions;
}

/**
 * Get project specific ignore paths
 */
async function getJavaIgnorePaths(projectType: MavenProjectType): Promise<string[]> {
  const baseIgnorePaths = [...DEFAULT_IGNORE_PATHS.JAVA];

  switch (projectType) {
    case MAVEN_PROJECT_TYPES.SPRING_BOOT:
      return [...baseIgnorePaths, 'target', '.mvn', '*.log'];
    case MAVEN_PROJECT_TYPES.MULTI_MODULE:
      return [...baseIgnorePaths, '**/target', '.mvn'];
    default:
      return baseIgnorePaths;
  }
}

/**
 * Maven project profile
 */
export const mavenProfile: ProjectProfile = {
  id: 'java-maven',
  name: 'Java/Maven',
  extensions: [...DEFAULT_EXTENSIONS.JAVA],
  ignorePaths: [...DEFAULT_IGNORE_PATHS.JAVA],
  detectionWeight: DETECTION_WEIGHTS.BASE.JAVA_BASE,

  /**
   * Detect if this is a Maven project
   */
  async detect(rootDir: string): Promise<boolean> {
    // Check for pom.xml
    const hasPom = await profileUtils.fileExists(rootDir, PROJECT_FILE_PATTERNS.JAVA.MAVEN);
    if (!hasPom) return false;

    // Verify it's a valid pom.xml
    const pomPath = path.join(rootDir, PROJECT_FILE_PATTERNS.JAVA.MAVEN);
    const pom = await readPomXml(pomPath);

    return pom !== null;
  },

  /**
   * Initialize Maven-specific configuration
   */
  async initialize(rootDir: string): Promise<void> {
    // Detect Maven project type
    const { type: projectType } = await detectMavenProjectType(rootDir);

    // Set Java-specific extensions
    this.extensions = await getJavaExtensions(rootDir);

    // Set Maven-specific ignore paths
    this.ignorePaths = await getJavaIgnorePaths(projectType);

    // Set appropriate lint command
    this.lintCommand = await detectLintCommand(rootDir);

    console.log(`Initialized Maven profile (${projectType})`);
  },
};

// Export utilities for other profiles that might extend Maven
export const mavenUtils = {
  readPomXml,
  detectMavenProjectType,
  getMavenCommand,
  detectLintCommand,
  getJavaExtensions,
  getJavaIgnorePaths,
};

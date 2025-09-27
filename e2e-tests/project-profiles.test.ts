import { test, expect, beforeEach, afterEach, describe } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

import {
  createTempDir,
  runGenaicode,
  createMockNpmProject,
  createMockGoProject,
  createMockMavenProject,
  cleanupTempDir,
  readJsonFile,
  GoProjectConfig,
  MavenProjectConfig,
} from './project-profiles-test-utils';

describe('project profile detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a fresh temporary directory for each test
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    // Clean up the temporary directory
    await cleanupTempDir(tempDir);
  });

  describe('npm projects', () => {
    test('npm project profile detection and .genaicoderc generation', async () => {
      // Create a mock npm project
      await createMockNpmProject(tempDir);

      // Run genaicode in the project directory
      await runGenaicode(tempDir);

      // Verify .genaicoderc file exists and has correct content
      const rcPath = path.join(tempDir, '.genaicoderc');
      const rcContent = await readJsonFile(rcPath);

      // Verify the content matches npm profile expectations
      expect(rcContent).toMatchObject({
        rootDir: '.',
        // Extensions should include TypeScript since we created tsconfig.json
        extensions: expect.arrayContaining(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.json', '.md', '.d.ts']),
        // Should include standard npm ignore paths
        ignorePaths: expect.arrayContaining(['node_modules', 'build', 'dist', 'coverage', '.next', '.cache']),
        // Should detect the lint command from package.json
        lintCommand: 'npm run lint',
      });
    });
  });

  describe('golang projects', () => {
    test('basic Go module detection', async () => {
      const config: GoProjectConfig = {
        moduleName: 'example.com/test-project',
        useLinter: false,
      };

      await createMockGoProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent).toMatchObject({
        rootDir: '.',
        extensions: expect.arrayContaining(['.go', '.mod', '.sum', '.md']),
        ignorePaths: expect.arrayContaining(['vendor', 'bin', 'dist']),
        lintCommand: 'go vet ./...',
      });
    });

    test('Go workspace detection', async () => {
      const config: GoProjectConfig = {
        moduleName: 'example.com/test-workspace',
        isWorkspace: true,
        workspaceModules: ['module1', 'module2'],
        useLinter: false,
      };

      await createMockGoProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent).toMatchObject({
        extensions: expect.arrayContaining(['.go', '.mod', '.sum', '.work', '.md']),
        ignorePaths: expect.arrayContaining(['vendor', 'bin', 'dist', '**/bin', '**/dist']),
      });
    });

    test('Go project with Gin framework', async () => {
      const config: GoProjectConfig = {
        moduleName: 'example.com/gin-project',
        framework: 'gin',
        useLinter: false,
      };

      await createMockGoProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent.extensions).toContain('.go');
    });

    test('Go project with golangci-lint', async () => {
      const config: GoProjectConfig = {
        moduleName: 'example.com/linted-project',
        useLinter: true,
      };

      await createMockGoProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent.lintCommand).toBe('golangci-lint run');
    });
  });

  describe('java/maven projects', () => {
    test('basic Maven project detection', async () => {
      const config: MavenProjectConfig = {
        type: 'standard',
        groupId: 'com.example',
        artifactId: 'test-project',
      };

      await createMockMavenProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent).toMatchObject({
        rootDir: '.',
        extensions: expect.arrayContaining(['.java', '.xml', '.properties', '.md']),
        ignorePaths: expect.arrayContaining(['target', 'build', 'out', '.gradle', '.mvn', '.settings']),
      });
    });

    test('Spring Boot project detection', async () => {
      const config: MavenProjectConfig = {
        type: 'spring-boot',
        useWrapper: true,
      };

      await createMockMavenProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent).toMatchObject({
        ignorePaths: expect.arrayContaining(['target', '.mvn', '*.log']),
        lintCommand: expect.stringContaining('./mvnw'),
      });
    });

    test('Maven multi-module project', async () => {
      const config: MavenProjectConfig = {
        type: 'multi-module',
        modules: ['module1', 'module2', 'module3'],
        useWrapper: true,
      };

      await createMockMavenProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent).toMatchObject({
        ignorePaths: expect.arrayContaining(['**/target', '.mvn']),
      });
    });

    test('Jakarta EE project detection', async () => {
      const config: MavenProjectConfig = {
        type: 'jakarta-ee',
        useCheckstyle: true,
      };

      await createMockMavenProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent.lintCommand).toBe('mvn checkstyle:check');
    });

    test('Maven project with Kotlin support', async () => {
      const config: MavenProjectConfig = {
        type: 'standard',
        useKotlin: true,
      };

      await createMockMavenProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent.extensions).toEqual(expect.arrayContaining(['.java', '.kt', '.kts']));
    });

    test('Maven project with Scala support', async () => {
      const config: MavenProjectConfig = {
        type: 'standard',
        useScala: true,
      };

      await createMockMavenProject(tempDir, config);
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      expect(rcContent.extensions).toEqual(expect.arrayContaining(['.java', '.scala']));
    });
  });

  describe('edge cases and error scenarios', () => {
    test('handles non-existent directory gracefully', async () => {
      const nonExistentDir = path.join(tempDir, 'non-existent');
      await expect(runGenaicode(nonExistentDir)).rejects.toThrow();
    });

    test('handles empty directory gracefully', async () => {
      await runGenaicode(tempDir);

      const rcPath = path.join(tempDir, '.genaicoderc');
      const rcContent = await readJsonFile(rcPath);

      // Should fall back to npm profile defaults
      expect(rcContent).toMatchObject({
        rootDir: '.',
        extensions: expect.arrayContaining(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.json', '.md']),
        ignorePaths: expect.arrayContaining(['node_modules', 'build', 'dist', 'coverage', '.next', '.cache']),
      });
    });

    test('handles invalid Maven POM file', async () => {
      // Create an invalid pom.xml
      await fs.writeFile(path.join(tempDir, 'pom.xml'), 'invalid xml content');
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      // Should not detect as Maven project
      expect(rcContent.extensions).not.toContain('.java');
    });

    test('handles invalid Go module file', async () => {
      // Create an invalid go.mod
      await fs.writeFile(path.join(tempDir, 'go.mod'), 'invalid go.mod content');
      await runGenaicode(tempDir);

      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));
      // Should not detect as Go project
      expect(rcContent.extensions).not.toContain('.go');
    });

    test('handles mixed project types gracefully', async () => {
      // Create both Maven and Go files
      await createMockMavenProject(tempDir, { type: 'standard' });
      await createMockGoProject(tempDir, { moduleName: 'example.com/mixed' });

      await runGenaicode(tempDir);
      const rcContent = await readJsonFile(path.join(tempDir, '.genaicoderc'));

      // Should detect one of the project types based on weight
      expect(rcContent.extensions).toEqual(
        expect.arrayContaining(
          rcContent.extensions?.includes('.java')
            ? ['.java', '.xml', '.properties', '.md']
            : ['.go', '.mod', '.sum', '.md'],
        ),
      );
    });
  });
});

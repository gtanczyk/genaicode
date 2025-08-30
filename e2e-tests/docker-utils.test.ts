import { describe, test, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import {
  pullImage,
  createAndStartContainer,
  executeCommand,
  stopContainer,
  copyToContainer,
  copyFromContainer,
} from '../src/prompt/steps/step-ask-question/handlers/container-task/utils/docker-utils.js';
import type { AllowedDockerImage } from '../src/prompt/function-defs/run-container-task.js';
import { rcConfig } from '../src/main/config.js';

/**
 * End-to-end tests for Docker utilities
 *
 * These tests verify that the Docker utility functions work correctly:
 * - Pull Docker images from the allowed list
 * - Create and start containers
 * - Execute commands inside containers
 * - Handle errors gracefully
 * - Clean up containers properly
 *
 * Tests are automatically skipped if Docker is not available on the system.
 */
describe('Docker Utils E2E Tests', () => {
  let docker: Docker;
  let isDockerAvailable = false;
  const testImage: AllowedDockerImage = 'alpine:latest';
  let testContainer: Docker.Container | null = null;

  beforeAll(async () => {
    // Check if Docker is available
    try {
      docker = new Docker();
      await docker.ping();
      isDockerAvailable = true;

      // Pre-pull the image to avoid repeated pulls
      if (isDockerAvailable) {
        await pullImage(docker, testImage);
      }
    } catch (error) {
      console.warn('Docker is not available, skipping Docker utils tests');
      isDockerAvailable = false;
    }
  }, 60000);

  afterEach(async () => {
    // Clean up any test container
    if (testContainer && isDockerAvailable) {
      try {
        await stopContainer(testContainer);
      } catch (error) {
        // Container might already be stopped, try force removal
        try {
          await testContainer.remove({ force: true });
        } catch (removeError) {
          // Ignore removal errors
        }
      }
      testContainer = null;
    }
  }, 30000);

  test('should detect Docker availability', async () => {
    if (!isDockerAvailable) {
      console.log('✅ Test correctly skipped - Docker not available');
      expect(true).toBe(true);
    } else {
      console.log('✅ Docker is available and working');
      expect(isDockerAvailable).toBe(true);
      expect(docker).toBeDefined();
    }
  });

  test('should pull a Docker image successfully', async () => {
    if (!isDockerAvailable) {
      console.log('Skipping test - Docker not available');
      return;
    }

    // Image should already be pulled in beforeAll, this verifies it works
    await expect(pullImage(docker, testImage)).resolves.not.toThrow();
  }, 30000);

  test('should create and start a container', async () => {
    if (!isDockerAvailable) {
      console.log('Skipping test - Docker not available');
      return;
    }

    // Create and start container
    testContainer = await createAndStartContainer(docker, testImage);

    expect(testContainer).toBeDefined();
    expect(testContainer.id).toBeDefined();
    expect(typeof testContainer.id).toBe('string');
    expect(testContainer.id.length).toBeGreaterThan(0);
  }, 30000);

  test('should execute commands in a container', async () => {
    if (!isDockerAvailable) {
      console.log('Skipping test - Docker not available');
      return;
    }

    // Setup container
    testContainer = await createAndStartContainer(docker, testImage);

    // Test basic command execution
    const result1 = await executeCommand(testContainer, '/bin/sh', 'echo "Hello Docker"', '', '/');
    expect(result1.output).toBe('Hello Docker');
    expect(result1.exitCode).toBe(0);

    // Test command with non-zero exit code
    const result2 = await executeCommand(testContainer, '/bin/sh', 'exit 1', '', '/');
    expect(result2.exitCode).toBe(1);

    // Test file operations
    const result3 = await executeCommand(
      testContainer,
      '/bin/sh',
      'echo "test content" > /tmp/test.txt && cat /tmp/test.txt',
      '',
      '/',
    );
    expect(result3.output).toBe('test content');
    expect(result3.exitCode).toBe(0);
  }, 30000);

  test('should handle command execution errors gracefully', async () => {
    if (!isDockerAvailable) {
      console.log('Skipping test - Docker not available');
      return;
    }

    // Setup container
    testContainer = await createAndStartContainer(docker, testImage);

    // Test command that doesn't exist
    const result = await executeCommand(testContainer, '/bin/sh', 'nonexistentcommand', '', '/');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('not found');
  }, 30000);

  test('should stop container successfully', async () => {
    if (!isDockerAvailable) {
      console.log('Skipping test - Docker not available');
      return;
    }

    // Setup container
    testContainer = await createAndStartContainer(docker, testImage);

    // Stop should complete without throwing
    await expect(stopContainer(testContainer)).resolves.not.toThrow();

    // Verify container is stopped by checking if we can still execute commands
    // This should fail since container is stopped
    await expect(executeCommand(testContainer, '/bin/sh', 'echo "test"', '', '/')).rejects.toThrow();

    testContainer = null; // Mark as cleaned up
  }, 30000);

  test('should handle working directory and environment', async () => {
    if (!isDockerAvailable) {
      console.log('Skipping test - Docker not available');
      return;
    }

    testContainer = await createAndStartContainer(docker, testImage);

    // Test working directory
    const pwdResult = await executeCommand(testContainer, '/bin/sh', 'pwd', '', '/');
    expect(pwdResult.output).toBe('/');

    // Test environment variables
    const envResult = await executeCommand(testContainer, '/bin/sh', 'echo $HOME', '', '/');
    expect(envResult.output).toBe('/root');

    // Test creating and changing directory
    const cdResult = await executeCommand(
      testContainer,
      '/bin/sh',
      'mkdir -p /test/dir && cd /test/dir && pwd',
      '',
      '/',
    );
    expect(cdResult.output).toBe('/test/dir');
  }, 30000);

  describe('File Transfer Tests', () => {
    const tempDirHost = path.join(rcConfig.rootDir, 'temp-test-dir-host');
    const tempDirHostNested = path.join(tempDirHost, 'nested');
    const tempDirFromContainer = path.join(rcConfig.rootDir, 'temp-test-dir-from-container');

    beforeEach(() => {
      // Clean up and create temp directories for each test
      if (fs.existsSync(tempDirHost)) fs.rmSync(tempDirHost, { recursive: true, force: true });
      if (fs.existsSync(tempDirFromContainer)) fs.rmSync(tempDirFromContainer, { recursive: true, force: true });
      fs.mkdirSync(tempDirHostNested, { recursive: true });
      fs.mkdirSync(tempDirFromContainer, { recursive: true });
    });

    afterEach(() => {
      // Cleanup temp directories
      if (fs.existsSync(tempDirHost)) fs.rmSync(tempDirHost, { recursive: true, force: true });
      if (fs.existsSync(tempDirFromContainer)) fs.rmSync(tempDirFromContainer, { recursive: true, force: true });
    });

    test('should copy a directory with nested files to the container', async () => {
      if (!isDockerAvailable) {
        console.log('Skipping test - Docker not available');
        return;
      }

      // 1. Create a nested directory structure on the host
      fs.writeFileSync(path.join(tempDirHost, 'root.txt'), 'root file');
      fs.writeFileSync(path.join(tempDirHostNested, 'nested.txt'), 'nested file');
      fs.mkdirSync(path.join(tempDirHostNested, 'empty-dir'));

      // 2. Setup container
      testContainer = await createAndStartContainer(docker, testImage);
      await executeCommand(testContainer, '/bin/sh', 'mkdir /data', '', '/');

      // 3. Copy to container
      await copyToContainer(testContainer, tempDirHost, '/data');

      // 4. Verify the structure inside the container
      const { output, exitCode } = await executeCommand(testContainer, '/bin/sh', 'find /data', '', '/');
      expect(exitCode).toBe(0);
      const files = output
        .split('\n')
        .map((f) => f.trim())
        .sort();

      expect(files).toContain('/data/root.txt');
      expect(files).toContain('/data/nested/nested.txt');
      // Note: Empty directories are included in the transfer

      // 5. Verify file content
      const rootContent = await executeCommand(testContainer, '/bin/sh', 'cat /data/root.txt', '', '/');
      expect(rootContent.output).toBe('root file');

      const nestedContent = await executeCommand(testContainer, '/bin/sh', 'cat /data/nested/nested.txt', '', '/');
      expect(nestedContent.output).toBe('nested file');
    }, 60000);

    test('should copy a directory with nested files from the container', async () => {
      if (!isDockerAvailable) {
        console.log('Skipping test - Docker not available');
        return;
      }

      // 1. Setup container and create file structure inside it
      testContainer = await createAndStartContainer(docker, testImage);
      await executeCommand(testContainer, '/bin/sh', 'mkdir -p /app/src && echo "source" > /app/src/index.js', '', '/');
      await executeCommand(
        testContainer,
        '/bin/sh',
        'mkdir -p /app/test && echo "test" > /app/test/index.test.js',
        '',
        '/',
      );

      // 2. Copy from container
      await copyFromContainer(testContainer, '/app', tempDirFromContainer);

      // 3. Verify the structure on the host
      expect(fs.existsSync(path.join(tempDirFromContainer, 'app/src/index.js'))).toBe(true);
      expect(fs.existsSync(path.join(tempDirFromContainer, 'app/test/index.test.js'))).toBe(true);

      // 4. Verify file content
      const sourceContent = fs.readFileSync(path.join(tempDirFromContainer, 'app/src/index.js'), 'utf-8');
      expect(sourceContent.trim()).toBe('source');
      const testContent = fs.readFileSync(path.join(tempDirFromContainer, 'app/test/index.test.js'), 'utf-8');
      expect(testContent.trim()).toBe('test');
    }, 60000);

    test('should perform a round-trip copy (host -> container -> host)', async () => {
      if (!isDockerAvailable) {
        console.log('Skipping test - Docker not available');
        return;
      }

      // 1. Create initial host structure
      fs.writeFileSync(path.join(tempDirHost, 'file1.txt'), 'file one');
      fs.writeFileSync(path.join(tempDirHostNested, 'file2.txt'), 'file two');

      // 2. Setup container
      testContainer = await createAndStartContainer(docker, testImage);
      await executeCommand(testContainer, '/bin/sh', 'mkdir /data_in', '', '/');

      // 3. Copy to container
      await copyToContainer(testContainer, tempDirHost, '/data_in');

      // 4. Verify in container
      const findInResult = await executeCommand(testContainer, '/bin/sh', 'find /data_in', '', '/');
      expect(findInResult.output).toContain('/data_in/nested/file2.txt');

      // 5. Copy from container to a different host directory
      await copyFromContainer(testContainer, '/data_in', tempDirFromContainer);

      // 6. Verify the round-tripped structure on the host
      expect(fs.existsSync(path.join(tempDirFromContainer, 'data_in/file1.txt'))).toBe(true);
      expect(fs.existsSync(path.join(tempDirFromContainer, 'data_in/nested/file2.txt'))).toBe(true);
      const content1 = fs.readFileSync(path.join(tempDirFromContainer, 'data_in/file1.txt'), 'utf-8');
      expect(content1).toBe('file one');
      const content2 = fs.readFileSync(path.join(tempDirFromContainer, 'data_in/nested/file2.txt'), 'utf-8');
      expect(content2).toBe('file two');
    }, 60000);

    test('abort signal', async () => {
      if (!isDockerAvailable) {
        console.log('Skipping test - Docker not available');
        return;
      }

      const abortController = new AbortController();

      // Simulate a long-running command
      testContainer = await createAndStartContainer(docker, testImage);
      const timeout = setTimeout(() => abortController.abort(), 1000);
      const longRunningCommand = await executeCommand(
        testContainer,
        '/bin/sh',
        'sleep 10',
        '',
        '/',
        abortController.signal,
      );
      expect(longRunningCommand.output).toContain('Aborted command execution');

      clearTimeout(timeout);
    });
  });
});

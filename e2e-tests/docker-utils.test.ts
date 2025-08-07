import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import Docker from 'dockerode';
import { pullImage, createAndStartContainer, executeCommand, stopContainer } from '../src/utils/docker-utils.js';
import type { AllowedDockerImage } from '../src/prompt/function-defs/run-container-task.js';

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
    const result1 = await executeCommand(testContainer, 'echo "Hello Docker"');
    expect(result1.output).toBe('Hello Docker');
    expect(result1.exitCode).toBe(0);

    // Test command with non-zero exit code
    const result2 = await executeCommand(testContainer, 'exit 1');
    expect(result2.exitCode).toBe(1);

    // Test file operations
    const result3 = await executeCommand(testContainer, 'echo "test content" > /tmp/test.txt && cat /tmp/test.txt');
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
    const result = await executeCommand(testContainer, 'nonexistentcommand');
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
    await expect(executeCommand(testContainer, 'echo "test"')).rejects.toThrow();

    testContainer = null; // Mark as cleaned up
  }, 30000);

  test('should handle working directory and environment', async () => {
    if (!isDockerAvailable) {
      console.log('Skipping test - Docker not available');
      return;
    }

    testContainer = await createAndStartContainer(docker, testImage);

    // Test working directory
    const pwdResult = await executeCommand(testContainer, 'pwd');
    expect(pwdResult.output).toBe('/');

    // Test environment variables
    const envResult = await executeCommand(testContainer, 'echo $HOME');
    expect(envResult.output).toBe('/root');

    // Test creating and changing directory
    const cdResult = await executeCommand(testContainer, 'mkdir -p /test/dir && cd /test/dir && pwd');
    expect(cdResult.output).toBe('/test/dir');
  }, 30000);
});

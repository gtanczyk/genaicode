import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';

const execAsync = promisify(exec);

describe('GitHub Models Integration E2E Tests', () => {
  const CLI_PATH = resolve(process.cwd(), 'bin/genaicode.cjs');

  it('should successfully generate content using GitHub Models with CLI', async () => {
    const prompt = 'Write a simple hello world function in JavaScript that returns "Hello, World!"';

    const command = `node "${CLI_PATH}" --ai-service=github-models --explicit-prompt="${prompt}" --dry-run`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 15000, // Shorter timeout
      });

      // Verify the command executed successfully
      expect(stderr).toBe('');

      // Verify that the output contains expected patterns
      // The dry-run should show what would be generated without actually writing files
      expect(stdout).toContain('Hello, World!');

      // Verify that GitHub Models service was used
      expect(stdout).toMatch(/Using.*github-models/i);
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };

      // Provide helpful error information (without exposing token)
      console.error('Command failed:', command.replace(/GITHUB_TOKEN=[^\s]*/g, 'GITHUB_TOKEN=***'));
      console.error('Error code:', execError.code);
      console.error('stdout:', execError.stdout);
      console.error('stderr:', execError.stderr);

      // If the API is rate limited or has issues, provide helpful context
      if (execError.stderr?.includes('rate limit') || execError.stderr?.includes('quota')) {
        console.warn('GitHub Models API rate limit reached. This is expected in CI environments.');
        return; // Don't fail the test for rate limits
      }

      throw error;
    }
  }, 45000); // 45 second timeout for the test itself

  it('should validate GitHub Models configuration and model selection', async () => {
    const prompt = 'What is 2 + 2?';

    const command = `node "${CLI_PATH}" --ai-service=github-models --explicit-prompt="${prompt}" --dry-run`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        env: {
          ...process.env,
          GITHUB_TOKEN: '', // Explicitly unset the token for this test
        },
        timeout: 15000, // Shorter timeout
      });

      // If GITHUB_TOKEN is available, should succeed
      if (process.env.GITHUB_TOKEN) {
        // Verify no errors
        expect(stderr).toBe('');

        // Verify numeric response is present
        expect(stdout).toMatch(/[4|four]/i);

        // Verify the service was configured correctly
        expect(stdout).toMatch(/github-models/i);
      } else {
        // If no token, should show proper error message
        const errorOutput = stderr + stdout;
        expect(errorOutput).toContain('GitHub Models API token not configured');
      }
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };

      console.error('Command failed:', command.replace(/GITHUB_TOKEN=[^\s]*/g, 'GITHUB_TOKEN=***'));
      console.error('Error code:', execError.code);
      console.error('stdout:', execError.stdout);
      console.error('stderr:', execError.stderr);

      // Handle rate limits gracefully
      if (execError.stderr?.includes('rate limit') || execError.stderr?.includes('quota')) {
        console.warn('GitHub Models API rate limit reached. This is expected in CI environments.');
        return;
      }

      // If no token is provided, expect specific error handling
      if (!process.env.GITHUB_TOKEN) {
        const errorOutput = (execError.stderr || '') + (execError.stdout || '');
        expect(errorOutput).toContain('GitHub Models API token not configured');
        return;
      }

      throw error;
    }
  }, 45000);

  it('should show helpful error when GITHUB_TOKEN is missing', async () => {
    // This test runs even without GITHUB_TOKEN to verify error handling
    const prompt = 'Test prompt';

    const command = `node "${CLI_PATH}" --ai-service=github-models --explicit-prompt="${prompt}" --dry-run`;

    try {
      const { stderr } = await execAsync(command, {
        env: {
          ...process.env,
          GITHUB_TOKEN: '', // Explicitly unset the token
        },
        timeout: 10000,
      });

      // Should fail when no token is provided
      expect(stderr).toContain('GitHub Models API token not configured');
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };

      // Command should exit with error code when token is missing
      expect(execError.code).toBeGreaterThan(0);
      expect(execError.stderr).toContain('GitHub Models API token not configured');
    }
  });
});

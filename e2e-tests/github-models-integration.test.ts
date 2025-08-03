import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';

const execAsync = promisify(exec);

describe('GitHub Models Integration E2E Tests', () => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const CLI_PATH = resolve(process.cwd(), 'bin/genaicode.cjs');

  // Skip tests if GITHUB_TOKEN is not available
  const testIf = GITHUB_TOKEN ? it : it.skip;

  testIf(
    'should successfully generate content using GitHub Models with CLI',
    async () => {
      const prompt = 'Write a simple hello world function in JavaScript that returns "Hello, World!"';

      const command = `node "${CLI_PATH}" --ai-service=github-models --explicit-prompt="${prompt}" --dry-run`;

      try {
        const { stdout, stderr } = await execAsync(command, {
          env: {
            ...process.env,
            GITHUB_TOKEN,
          },
          timeout: 30000, // 30 second timeout
        });

        // Verify the command executed successfully
        expect(stderr).toBe('');

        // Verify that the output contains expected patterns
        // The dry-run should show what would be generated without actually writing files
        expect(stdout).toContain('Hello, World!');

        // Verify that GitHub Models service was used
        expect(stdout).toMatch(/Using.*github-models/i);
      } catch (error: any) {
        // Provide helpful error information
        console.error('Command failed:', command);
        console.error('Error:', error);
        console.error('stdout:', error.stdout);
        console.error('stderr:', error.stderr);

        // If the API is rate limited or has issues, provide helpful context
        if (error.stderr?.includes('rate limit') || error.stderr?.includes('quota')) {
          console.warn('GitHub Models API rate limit reached. This is expected in CI environments.');
          return; // Don't fail the test for rate limits
        }

        throw error;
      }
    },
    45000,
  ); // 45 second timeout for the test itself

  testIf(
    'should validate GitHub Models configuration and model selection',
    async () => {
      const prompt = 'What is 2 + 2?';

      const command = `node "${CLI_PATH}" --ai-service=github-models --explicit-prompt="${prompt}" --dry-run`;

      try {
        const { stdout, stderr } = await execAsync(command, {
          env: {
            ...process.env,
            GITHUB_TOKEN,
          },
          timeout: 30000,
        });

        // Verify no errors
        expect(stderr).toBe('');

        // Verify numeric response is present
        expect(stdout).toMatch(/[4|four]/i);

        // Verify the service was configured correctly
        expect(stdout).toMatch(/github-models/i);
      } catch (error: any) {
        console.error('Command failed:', command);
        console.error('Error:', error);
        console.error('stdout:', error.stdout);
        console.error('stderr:', error.stderr);

        // Handle rate limits gracefully
        if (error.stderr?.includes('rate limit') || error.stderr?.includes('quota')) {
          console.warn('GitHub Models API rate limit reached. This is expected in CI environments.');
          return;
        }

        throw error;
      }
    },
    45000,
  );

  it('should show helpful error when GITHUB_TOKEN is missing', async () => {
    // This test runs even without GITHUB_TOKEN to verify error handling
    const prompt = 'Test prompt';

    const command = `node "${CLI_PATH}" --ai-service=github-models --explicit-prompt="${prompt}" --dry-run`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        env: {
          ...process.env,
          GITHUB_TOKEN: '', // Explicitly unset the token
        },
        timeout: 10000,
      });

      // Should fail when no token is provided
      expect(stderr).toContain('GitHub Models API token not configured');
    } catch (error: any) {
      // Command should exit with error code when token is missing
      expect(error.code).toBeGreaterThan(0);
      expect(error.stderr).toContain('GitHub Models API token not configured');
    }
  });

  // Log information about test environment
  if (!GITHUB_TOKEN) {
    console.log('⚠️  GITHUB_TOKEN not available - GitHub Models integration tests will be skipped');
    console.log('   These tests will run automatically in GitHub Actions CI environment');
  } else {
    console.log('✅ GITHUB_TOKEN available - GitHub Models integration tests will run');
  }
});

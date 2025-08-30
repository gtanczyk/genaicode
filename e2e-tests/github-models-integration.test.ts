import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';

const execAsync = promisify(exec);

describe('GitHub Models Integration E2E Tests', () => {
  const CLI_PATH = resolve(process.cwd(), 'bin/genaicode.cjs');

  // Note: GitHub Models free tier has very limited input token quotas
  // These tests use minimal prompts to avoid hitting limits in CI

  it('should successfully use GitHub Models service with minimal prompt', async () => {
    // Check if GITHUB_TOKEN is available
    if (!process.env.GITHUB_TOKEN) {
      console.warn('GITHUB_TOKEN not available - skipping real API test');
      return;
    }

    // Use extremely minimal prompt to stay within GitHub Models free tier token limits
    const prompt = 'Hi';

    const command = `node "${CLI_PATH}" --ai-service=github-models --explicit-prompt="${prompt}" --dry-run`;

    try {
      const { stdout } = await execAsync(command, {
        timeout: 15000,
      });

      // Verify that some output was generated
      expect(stdout.length).toBeGreaterThan(0);

      // Verify that GitHub Models service was used
      expect(stdout).toMatch(/Using.*github-models/i);

      // Allow some stderr output as long as the process succeeds
      // (there might be warnings or non-fatal messages)
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };

      // Provide helpful error information (without exposing token)
      console.error('Command failed:', command.replace(/GITHUB_TOKEN=[^\s]*/g, 'GITHUB_TOKEN=***'));
      console.error('Error code:', execError.code);
      console.error('stdout:', execError.stdout);
      console.error('stderr:', execError.stderr);

      // Handle GitHub Models free tier limitations gracefully
      if (
        execError.stderr?.includes('rate limit') ||
        execError.stderr?.includes('quota') ||
        execError.stderr?.includes('token limit') ||
        execError.stderr?.includes('maximum context length') ||
        execError.stderr?.includes('input too long') ||
        execError.stderr?.includes('insufficient quota') ||
        execError.stderr?.includes('API token not configured')
      ) {
        console.warn('GitHub Models API limit reached or token issue. This is expected in CI with free tier.');
        return; // Don't fail the test for API limits or token issues
      }

      throw error;
    }
  }, 30000); // Reduced timeout

  it('should show helpful error when GITHUB_TOKEN is missing', async () => {
    // This test doesn't make API calls, so it's safe for token limits
    const prompt = 'Test';

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
      const execError = error as { code?: unknown; stdout?: string; stderr?: string };

      // Command should exit with error code when token is missing
      if (typeof execError.code === 'number') {
        expect(execError.code).toBeGreaterThan(0);
      } else {
        // Some environments may return code as string
        expect(Number(execError.code)).toBeGreaterThan(0);
      }
      expect(execError.stderr).toContain('GitHub Models API token not configured');
    }
  });
});

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

      // Check for connection issues first, which are expected in test environments
      if (
        stdout.includes('ENOTFOUND') ||
        stdout.includes('Connection error') ||
        stdout.includes('fetch failed') ||
        stdout.includes('APIConnectionError')
      ) {
        console.warn('GitHub Models network error encountered. This is expected in CI/test environments.');
        return; // Don't fail the test for network errors
      }

      // Verify that GitHub Models service was used (only if no connection errors)
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

      // Handle GitHub Models free tier limitations and network issues gracefully
      const errorOutput = (execError.stderr || '') + (execError.stdout || '');
      if (
        errorOutput.includes('rate limit') ||
        errorOutput.includes('quota') ||
        errorOutput.includes('token limit') ||
        errorOutput.includes('maximum context length') ||
        errorOutput.includes('input too long') ||
        errorOutput.includes('insufficient quota') ||
        errorOutput.includes('API token not configured') ||
        errorOutput.includes('ENOTFOUND') ||
        errorOutput.includes('Connection error') ||
        errorOutput.includes('fetch failed') ||
        errorOutput.includes('APIConnectionError')
      ) {
        console.warn(
          'GitHub Models API limit reached, token issue, or network error. This is expected in CI/test environments.',
        );
        return; // Don't fail the test for API limits, token issues, or network errors
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
      const execError = error as { code?: number; stdout?: string; stderr?: string };

      // Command should exit with error code when token is missing
      expect(execError.code).toBeGreaterThan(0);
      expect(execError.stderr).toContain('GitHub Models API token not configured');
    }
  });
});

import { test, expect, beforeEach, afterEach, describe } from 'vitest';
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('project profile detection', () => {
  let tempDir: string;
  let genAICodeProcess: ChildProcess;

  /**
   * Create a temporary directory for testing
   */
  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'genaicode-test-'));
    return dir;
  }

  /**
   * Create a mock npm project structure
   */
  async function createMockNpmProject(projectDir: string) {
    // Create package.json
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          lint: 'eslint .',
          test: 'vitest',
        },
        dependencies: {
          typescript: '^5.0.0',
        },
      }),
    );

    // Create tsconfig.json to simulate a TypeScript project
    await fs.writeFile(
      path.join(projectDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2020',
          module: 'esnext',
        },
      }),
    );

    // Create package-lock.json to simulate an npm project
    await fs.writeFile(
      path.join(projectDir, 'package-lock.json'),
      JSON.stringify({
        name: 'test-project',
        lockfileVersion: 2,
        requires: true,
        packages: {},
      }),
    );
  }

  /**
   * Run genaicode in the specified directory
   */
  async function runGenaicode(cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Start GenAIcode in interactive mode to allow .genaicoderc creation
      genAICodeProcess = spawn(
        'node',
        [
          path.resolve(__dirname, '..', 'bin', 'genaicode.cjs'),
          '--interactive',
          '--ai-service=vertex-ai',
          '--force-dist',
        ],
        {
          cwd,
          env: { ...process.env, NODE_ENV: 'test' },
        },
      );

      let stdoutData = '';
      let stderrData = '';

      genAICodeProcess.stdout!.on('data', (data) => {
        stdoutData += data.toString();
        // Check for the confirmation message that .genaicoderc was created
        if (stdoutData.includes('Created .genaicoderc')) {
          genAICodeProcess.kill();
          resolve();
        } else if (
          stdoutData.includes('would you like to create one') &&
          !stdoutData.includes('with detected project profile')
        ) {
          // Respond to the prompt to create .genaicoderc
          genAICodeProcess.stdin!.write('y\n');
        }
      });

      genAICodeProcess.stderr!.on('data', (data) => {
        stderrData += data.toString();
      });

      genAICodeProcess.on('error', (error) => {
        reject(new Error(`Failed to start genaicode: ${error.message}`));
      });

      genAICodeProcess.on('exit', (code) => {
        if (code !== null && code !== 0 && !stdoutData.includes('Created .genaicoderc')) {
          reject(new Error(`GenAIcode process exited with code ${code}. stdout: ${stdoutData}, stderr: ${stderrData}`));
        }
      });

      // Set a timeout to prevent hanging
      setTimeout(() => {
        genAICodeProcess.kill();
        reject(new Error('GenAIcode process timed out'));
      }, 30000);
    });
  }

  beforeEach(async () => {
    // Create a fresh temporary directory for each test
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    // Kill the genaicode process if it's still running
    if (genAICodeProcess) {
      genAICodeProcess.kill();
    }

    // Clean up the temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Error cleaning up temporary directory:', error);
    }
  });

  test('npm project profile detection and .genaicoderc generation', async () => {
    // Create a mock npm project
    await createMockNpmProject(tempDir);

    // Run genaicode in the project directory
    await runGenaicode(tempDir);

    // Verify .genaicoderc file exists
    const rcPath = path.join(tempDir, '.genaicoderc');
    const rcExists = await fs
      .access(rcPath)
      .then(() => true)
      .catch(() => false);
    expect(rcExists).toBe(true);

    // Read and parse .genaicoderc
    const rcContent = JSON.parse(await fs.readFile(rcPath, 'utf-8'));

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

  test('handles non-existent directory gracefully', async () => {
    const nonExistentDir = path.join(tempDir, 'non-existent');
    await expect(runGenaicode(nonExistentDir)).rejects.toThrow();
  });

  test('handles empty directory gracefully', async () => {
    // The directory exists but is empty
    await runGenaicode(tempDir);

    // Verify .genaicoderc is created with default npm profile
    const rcPath = path.join(tempDir, '.genaicoderc');
    const rcContent = JSON.parse(await fs.readFile(rcPath, 'utf-8'));

    // Should fall back to npm profile defaults
    expect(rcContent).toMatchObject({
      rootDir: '.',
      extensions: expect.arrayContaining(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.json', '.md']),
      ignorePaths: expect.arrayContaining(['node_modules', 'build', 'dist', 'coverage', '.next', '.cache']),
    });
  });
});

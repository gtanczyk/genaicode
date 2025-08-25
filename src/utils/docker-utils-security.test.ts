import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import tar from 'tar-stream';
import Docker from 'dockerode';
import { copyFromContainer } from '../utils/docker-utils.js';
import { rcConfig } from '../main/config.js';

/**
 * Test to demonstrate Zip Slip vulnerability in Docker utilities
 * This test creates a malicious tar archive with path traversal sequences
 * and verifies that the extraction is properly secured.
 */
describe('Zip Slip Security Tests', () => {
  test('should prevent path traversal attacks during archive extraction', async () => {
    // Create a temporary test directory within project root
    const testDir = path.join(rcConfig.rootDir, 'temp-zip-slip-test');
    const maliciousFile = path.join(rcConfig.rootDir, 'malicious-file.txt');

    // Clean up any existing test files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    if (fs.existsSync(maliciousFile)) {
      fs.unlinkSync(maliciousFile);
    }

    fs.mkdirSync(testDir, { recursive: true });

    try {
      // Create a malicious tar archive with path traversal
      const pack = tar.pack();

      // This should try to write outside the extraction directory
      const maliciousPath = '../malicious-file.txt';
      pack.entry({ name: maliciousPath }, 'This file should not be created!');
      pack.finalize();

      // Mock container.getArchive to return our malicious archive
      const mockContainer = {
        getArchive: () => Promise.resolve(pack),
      } as Pick<Docker.Container, 'getArchive'>;

      // This should now throw an error and NOT create the malicious file
      await expect(copyFromContainer(mockContainer, '/test', testDir)).rejects.toThrow(
        'Archive entry contains directory traversal sequences',
      );

      // Verify the malicious file was NOT created outside the target directory
      expect(fs.existsSync(maliciousFile)).toBe(false);
    } finally {
      // Clean up
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
      if (fs.existsSync(maliciousFile)) {
        fs.unlinkSync(maliciousFile);
      }
    }
  });

  test('should allow normal file extraction without path traversal', async () => {
    // Create a temporary test directory within project root
    const testDir = path.join(rcConfig.rootDir, 'temp-normal-test');

    // Clean up any existing test files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    fs.mkdirSync(testDir, { recursive: true });

    try {
      // Create a normal tar archive with safe paths
      const pack = tar.pack();

      // Normal safe paths
      pack.entry({ name: 'safe-file.txt' }, 'This is a safe file');
      pack.entry({ name: 'subdir/nested-file.txt' }, 'This is in a subdirectory');
      pack.finalize();

      // Mock container.getArchive to return our safe archive
      const mockContainer = {
        getArchive: () => Promise.resolve(pack),
      } as Pick<Docker.Container, 'getArchive'>;

      // This should work without errors
      await copyFromContainer(mockContainer, '/test', testDir);

      // Verify the safe files were created in the correct locations
      expect(fs.existsSync(path.join(testDir, 'safe-file.txt'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'subdir/nested-file.txt'))).toBe(true);

      // Verify file contents
      const content1 = fs.readFileSync(path.join(testDir, 'safe-file.txt'), 'utf-8');
      expect(content1).toBe('This is a safe file');

      const content2 = fs.readFileSync(path.join(testDir, 'subdir/nested-file.txt'), 'utf-8');
      expect(content2).toBe('This is in a subdirectory');
    } finally {
      // Clean up
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    }
  });
});

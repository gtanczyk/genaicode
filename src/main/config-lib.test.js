import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isAncestorDirectory } from '../files/file-utils.js';
import { findRcFile, parseRcFile } from './config-lib';

vi.mock('fs');
vi.mock('path');
vi.mock('../files/file-utils.js');

const CODEGENRC_FILENAME = '.genaicoderc';

// Mock data
const mockRcContent = JSON.stringify({ rootDir: 'src' });
const mockRootDir = '/project/src';
const mockRcFilePath = `/project/${CODEGENRC_FILENAME}`;

// Helper function to mock fs.existsSync
function mockExistsSync(paths) {
  return (p) => paths.includes(p);
}

// Tests

// Test for findRcFile
describe('findRcFile', () => {
  it('should find .genaicoderc in the current or parent directories', () => {
    fs.existsSync.mockImplementation(mockExistsSync([mockRcFilePath]));
    path.dirname.mockImplementation((p) => (p === '/project' ? '/' : '/project'));
    path.join.mockImplementation((...args) => args.join('/'));

    const result = findRcFile();
    expect(result).toBe(mockRcFilePath);
  });

  it('should throw an error if .genaicoderc is not found', () => {
    fs.existsSync.mockReturnValue(false);
    path.dirname.mockImplementation((p) => (p === '/' ? '/' : '/project'));

    expect(() => findRcFile()).toThrowError(`${CODEGENRC_FILENAME} not found in any parent directory`);
  });
});

// Test for parseRcFile
describe('parseRcFile', () => {
  it('should parse .genaicoderc and return config with rootDir', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(mockRcContent);
    path.resolve.mockImplementation((...args) => args.join('/'));
    path.dirname.mockReturnValue('/project');
    isAncestorDirectory.mockReturnValue(true);

    const result = parseRcFile(mockRcFilePath);
    expect(result).toEqual({ ...JSON.parse(mockRcContent), rootDir: mockRootDir });
  });

  it('should throw an error if .genaicoderc is missing', () => {
    fs.existsSync.mockReturnValue(false);

    expect(() => parseRcFile(mockRcFilePath)).toThrowError(`${CODEGENRC_FILENAME} not found`);
  });

  it('should throw an error if rootDir is not configured', () => {
    const invalidContent = JSON.stringify({});
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(invalidContent);

    expect(() => parseRcFile(mockRcFilePath)).toThrowError('Root dir not configured');
  });

  it('should throw an error if rootDir is not located inside project directory', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(mockRcContent);
    path.resolve.mockImplementation((...args) => args.join('/'));
    path.dirname.mockReturnValue('/project');
    isAncestorDirectory.mockReturnValue(false);

    expect(() => parseRcFile(mockRcFilePath)).toThrowError('Root dir is not located inside project directory');
  });
});

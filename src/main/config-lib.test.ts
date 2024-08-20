import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isAncestorDirectory } from '../files/file-utils.ts';
import { findRcFile, parseRcFile } from './config-lib.ts';

vi.mock('fs');
vi.mock('path');
vi.mock('../files/file-utils.ts');

const CODEGENRC_FILENAME = '.genaicoderc';

// Mock data
const mockRcContent = JSON.stringify({ rootDir: 'src' });
const mockRootDir = '/project/src';
const mockRcFilePath = `/project/${CODEGENRC_FILENAME}`;

// Helper function to mock fs.existsSync
function mockExistsSync(paths: string[]) {
  return (p: string | Buffer | URL) => paths.includes(p as string);
}

// Tests

// Test for findRcFile
describe('findRcFile', () => {
  it('should find .genaicoderc in the current or parent directories', () => {
    vi.mocked(fs).existsSync.mockImplementation(mockExistsSync([mockRcFilePath]));
    vi.mocked(path).dirname.mockImplementation((p) => (p === '/project' ? '/' : '/project'));
    vi.mocked(path).join.mockImplementation((...args) => args.join('/'));

    const result = findRcFile();
    expect(result).toBe(mockRcFilePath);
  });

  it('should throw an error if .genaicoderc is not found', () => {
    vi.mocked(fs).existsSync.mockReturnValue(false);
    vi.mocked(path).dirname.mockImplementation((p) => (p === '/' ? '/' : '/project'));

    expect(() => findRcFile()).toThrowError(`${CODEGENRC_FILENAME} not found in any parent directory`);
  });
});

// Test for parseRcFile
describe('parseRcFile', () => {
  it('should parse .genaicoderc and return config with rootDir', () => {
    vi.mocked(fs).existsSync.mockReturnValue(true);
    vi.mocked(fs).readFileSync.mockReturnValue(mockRcContent);
    vi.mocked(path).resolve.mockImplementation((...args) => args.join('/'));
    vi.mocked(path).dirname.mockReturnValue('/project');
    vi.mocked(isAncestorDirectory).mockReturnValue(true);

    const result = parseRcFile(mockRcFilePath);
    expect(result).toEqual({ ...JSON.parse(mockRcContent), rootDir: mockRootDir });
  });

  it('should throw an error if .genaicoderc is missing', () => {
    vi.mocked(fs).existsSync.mockReturnValue(false);

    expect(() => parseRcFile(mockRcFilePath)).toThrowError(`${CODEGENRC_FILENAME} not found`);
  });

  it('should throw an error if rootDir is not configured', () => {
    const invalidContent = JSON.stringify({});
    vi.mocked(fs).existsSync.mockReturnValue(true);
    vi.mocked(fs).readFileSync.mockReturnValue(invalidContent);

    expect(() => parseRcFile(mockRcFilePath)).toThrowError('Root dir not configured');
  });

  it('should throw an error if rootDir is not located inside project directory', () => {
    vi.mocked(fs).existsSync.mockReturnValue(true);
    vi.mocked(fs).readFileSync.mockReturnValue(mockRcContent);
    vi.mocked(path).resolve.mockImplementation((...args) => args.join('/'));
    vi.mocked(path).dirname.mockReturnValue('/project');
    vi.mocked(isAncestorDirectory).mockReturnValue(false);

    expect(() => parseRcFile(mockRcFilePath)).toThrowError('Root dir is not located inside project directory');
  });
});

import { vi, describe, beforeEach, it, expect } from 'vitest';
import { isAncestorDirectory } from './file-utils.js';

// Test for isAncestorDirectory
describe('isAncestorDirectory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return true if directories are the same', () => {
    expect(isAncestorDirectory('/project', '/project')).toBe(true);
  });

  it('should return true if parent is ancestor of dir', () => {
    expect(isAncestorDirectory('/project', '/project/src')).toBe(true);
  });

  it('should return false if parent is not ancestor of dir', () => {
    expect(isAncestorDirectory('/project', '/other')).toBe(false);
  });
});

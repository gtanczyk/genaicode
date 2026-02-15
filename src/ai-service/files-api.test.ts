import { describe, it, expect } from 'vitest';
import { registerFilesApiProvider, getFilesApiProvider, FilesApiProvider } from './files-api.js';

describe('files-api', () => {
  it('should return undefined for unknown service type', () => {
    const provider = getFilesApiProvider('unknown-service');
    expect(provider).toBeUndefined();
  });

  it('should return undefined when serviceType is undefined', () => {
    const provider = getFilesApiProvider(undefined);
    expect(provider).toBeUndefined();
  });

  it('should register and retrieve a files API provider', () => {
    const mockProvider: FilesApiProvider = {
      uploadFile: async () => ({ fileId: 'test', filename: 'test.txt', size: 100 }),
      downloadFile: async () => ({ filename: 'test.txt', content: Buffer.from('test'), mimeType: 'text/plain' }),
      deleteFile: async () => {},
    };

    registerFilesApiProvider('test-service', () => mockProvider);
    const provider = getFilesApiProvider('test-service');
    expect(provider).toBeDefined();
    expect(provider).toBe(mockProvider);
  });

  it('should create a new instance each time via factory', () => {
    let callCount = 0;
    const factory = () => {
      callCount++;
      return {
        uploadFile: async () => ({ fileId: `file-${callCount}`, filename: 'test.txt', size: 100 }),
        downloadFile: async () => ({ filename: 'test.txt', content: Buffer.from('test'), mimeType: 'text/plain' }),
        deleteFile: async () => {},
      } as FilesApiProvider;
    };

    registerFilesApiProvider('factory-test', factory);
    getFilesApiProvider('factory-test');
    getFilesApiProvider('factory-test');
    expect(callCount).toBe(2);
  });
});

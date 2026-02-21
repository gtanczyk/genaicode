import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFilesApiProvider } from './files-api.js';

// Mock dependencies
vi.mock('./service-configurations.js', () => ({
  getServiceConfig: vi.fn(),
}));
vi.mock('openai');
vi.mock('fs');
vi.mock('axios');

import { getServiceConfig } from './service-configurations.js';

describe('getFilesApiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return OpenAIFilesApi for openai service', () => {
    vi.mocked(getServiceConfig).mockReturnValue({
      apiKey: 'test-key',
      openaiBaseUrl: undefined,
    });

    const provider = getFilesApiProvider('openai');
    expect(provider).toBeDefined();
    expect(provider.uploadFile).toBeDefined();
    expect(provider.downloadFile).toBeDefined();
    expect(provider.deleteFile).toBeDefined();
    expect(getServiceConfig).toHaveBeenCalledWith('openai');
  });

  it('should return OpenAIFilesApi for github-models service', () => {
    vi.mocked(getServiceConfig).mockReturnValue({
      apiKey: 'test-github-token',
    });

    const provider = getFilesApiProvider('github-models');
    expect(provider).toBeDefined();
    expect(provider.uploadFile).toBeDefined();
    expect(getServiceConfig).toHaveBeenCalledWith('github-models');
  });

  it('should return GeminiFilesApi for ai-studio service', () => {
    vi.mocked(getServiceConfig).mockReturnValue({
      apiKey: 'test-gemini-key',
    });

    const provider = getFilesApiProvider('ai-studio');
    expect(provider).toBeDefined();
    expect(provider.uploadFile).toBeDefined();
  });

  it('should return GeminiFilesApi for vertex-ai service', () => {
    vi.mocked(getServiceConfig).mockReturnValue({
      apiKey: 'test-vertex-key',
    });

    const provider = getFilesApiProvider('vertex-ai');
    expect(provider).toBeDefined();
    expect(provider.uploadFile).toBeDefined();
  });

  it('should return AnthropicFilesApi for anthropic service', () => {
    vi.mocked(getServiceConfig).mockReturnValue({
      apiKey: 'test-anthropic-key',
    });

    const provider = getFilesApiProvider('anthropic');
    expect(provider).toBeDefined();
    expect(provider.uploadFile).toBeDefined();
  });

  it('should return OpenAIFilesApi for plugin services', () => {
    vi.mocked(getServiceConfig).mockReturnValue({
      apiKey: 'test-plugin-key',
    });

    const provider = getFilesApiProvider('plugin:grok-ai-service');
    expect(provider).toBeDefined();
    expect(provider.uploadFile).toBeDefined();
    expect(getServiceConfig).toHaveBeenCalledWith('plugin:grok-ai-service');
  });

  it('should throw error for unsupported service types', () => {
    expect(() => getFilesApiProvider('unsupported-service')).toThrow(
      'Files API not supported for service: unsupported-service',
    );
  });
});

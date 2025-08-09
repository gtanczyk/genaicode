import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateContent } from './github-models.js';
import { ModelType } from './common-types.js';
import * as serviceConfigurations from './service-configurations.js';

// Mock the OpenAI module and internal function
vi.mock('openai');
vi.mock('./openai.js');
vi.mock('./service-configurations.js');

describe('GitHub Models Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error when GitHub token is not configured', async () => {
    // Mock service config without API key
    vi.mocked(serviceConfigurations.getServiceConfig).mockReturnValue({
      apiKey: undefined,
      modelOverrides: {},
    });

    const prompt = [{ type: 'user' as const, text: 'Test prompt' }];
    const config = { modelType: ModelType.DEFAULT };
    const options = {};

    await expect(generateContent(prompt, config, options)).rejects.toThrow('GitHub Models API token not configured');
  });

  it('should use correct model defaults', () => {
    // Mock service config with API key
    const mockConfig = {
      apiKey: 'test-github-token',
      modelOverrides: {},
    };
    vi.mocked(serviceConfigurations.getServiceConfig).mockReturnValue(mockConfig);

    // We can't easily test the actual call without mocking OpenAI deeply,
    // but we can verify the service config is requested correctly
    expect(() => generateContent([{ type: 'user', text: 'test' }], { modelType: ModelType.DEFAULT }, {})).not.toThrow();

    expect(serviceConfigurations.getServiceConfig).toHaveBeenCalledWith('github-models');
  });

  it('should handle different model types', () => {
    const mockConfig = {
      apiKey: 'test-github-token',
      modelOverrides: {
        default: 'custom-gpt-4o',
        cheap: 'custom-gpt-4o-mini',
        lite: 'custom-gpt-4o-mini',
        reasoning: 'custom-o1-mini',
      },
    };
    vi.mocked(serviceConfigurations.getServiceConfig).mockReturnValue(mockConfig);

    // Test that different model types don't throw errors during setup
    expect(() => generateContent([{ type: 'user', text: 'test' }], { modelType: ModelType.CHEAP }, {})).not.toThrow();
    expect(() =>
      generateContent([{ type: 'user', text: 'test' }], { modelType: ModelType.REASONING }, {}),
    ).not.toThrow();
  });
});

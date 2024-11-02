import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promptService } from './prompt-service.js';
import * as aiStudio from '../ai-service/ai-studio.js';
import * as vertexAi from '../ai-service/vertex-ai.js';
import * as vertexAiClaude from '../ai-service/vertex-ai-claude.js';
import * as chatGpt from '../ai-service/chat-gpt.js';
import * as anthropic from '../ai-service/anthropic.js';
import * as cliParams from '../cli/cli-params.js';
import fs from 'fs';
import * as diff from 'diff';
import mime from 'mime-types';
import '../files/cache-file.js';
import { getImageAssets } from '../files/read-files.js';
import '../files/find-files.js';
import * as dalleService from '../ai-service/dall-e.js';
import * as vertexAiImagen from '../ai-service/vertex-ai-imagen.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { AiServiceType, ImagenType } from '../main/codegen-types.js';
import { GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.js';

vi.mock('../ai-service/vertex-ai-claude.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/vertex-ai.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/chat-gpt.js', () => ({ generateContent: vi.fn() }));
vi.mock('../ai-service/anthropic.js', () => ({ generateContent: vi.fn() }));
vi.mock('../cli/cli-params.js', () => ({
  disableExplanations: true,
  explicitPrompt: false,
  allowFileCreate: false,
  allowFileDelete: false,
  allowDirectoryCreate: false,
  allowFileMove: false,
  verbosePrompt: false,
  disableContextOptimization: true,
  vision: false,
  imagen: false,
  temperature: 0.7,
  cheap: false,
  askQuestion: false,
}));
vi.mock('fs');
vi.mock('diff');
vi.mock('mime-types');
vi.mock('../ai-service/dall-e.js', () => ({ generateImage: vi.fn() }));
vi.mock('../ai-service/vertex-ai-imagen.js', () => ({ generateImage: vi.fn() }));
vi.mock('../files/cache-file.js');
// Mock find-files module
vi.mock('../files/find-files.js', () => ({
  getSourceFiles: () => [],
  getImageAssetFiles: () => [],
}));

// Mock read-files module
vi.mock('../files/read-files.js', () => ({
  getSourceCode: () => ({}),
  getImageAssets: vi.fn(() => ({})),
}));

vi.mock('../main/config.js', () => ({
  rootDir: '/mocked/root/dir',
  rcConfig: {
    rootDir: '/mocked/root/dir',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
}));

const GENERATE_CONTENT_FNS: Record<AiServiceType, GenerateContentFunction> = {
  'vertex-ai-claude': vertexAiClaude.generateContent,
  'vertex-ai': vertexAi.generateContent,
  'ai-studio': aiStudio.generateContent,
  anthropic: anthropic.generateContent,
  'chat-gpt': chatGpt.generateContent,
} as const;

const GENERATE_IMAGE_FNS: Record<ImagenType, GenerateImageFunction> = {
  'dall-e': dalleService.generateImage,
  'vertex-ai': vertexAiImagen.generateImage,
} as const;

describe('promptService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cliParams).dryRun = false;
    vi.mocked(cliParams).vision = false;
    vi.mocked(cliParams).imagen = undefined;
    vi.mocked(cliParams).disableContextOptimization = false;
    vi.mocked(cliParams).explicitPrompt = 'testx';
  });

  it('should process the codegen summary and return the result with Vertex AI', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Hello");' } },
    ];
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'vertex-ai',
      }),
    );

    expect(result).toEqual(mockFunctionCalls);
    expect(vertexAi.generateContent).toHaveBeenCalled();
  });

  it('should process the codegen summary and return the result with ChatGPT', async () => {
    vi.mocked(cliParams).aiService = 'chat-gpt';
    const mockFunctionCalls = [{ name: 'createFile', args: { filePath: 'new.js', newContent: 'const x = 5;' } }];
    vi.mocked(chatGpt.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'chat-gpt',
      }),
    );

    expect(result).toEqual(mockFunctionCalls);
    expect(chatGpt.generateContent).toHaveBeenCalled();
  });

  it('should process the codegen summary and return the result with Anthropic', async () => {
    vi.mocked(cliParams).aiService = 'anthropic';
    const mockFunctionCalls = [{ name: 'deleteFile', args: { filePath: 'obsolete.js' } }];
    vi.mocked(anthropic.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'anthropic',
      }),
    );

    expect(result).toEqual(mockFunctionCalls);
    expect(anthropic.generateContent).toHaveBeenCalled();
  });

  it('should not update files in dry run mode', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).dryRun = true;
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Dry run");' } },
    ];
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'vertex-ai',
      }),
    );

    expect(result).toEqual(mockFunctionCalls);
    expect(vertexAi.generateContent).toHaveBeenCalled();
  });

  it('should handle invalid patchFile call and retry without patchFile function', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [{ filePath: '/mocked/root/dir/test.js', updateToolName: 'patchFile', prompt: 'Generate file' }],
          contextPaths: [],
          explanation: 'Mock summary',
        },
      },
    ];
    const mockInvalidPatchCall = [
      {
        name: 'patchFile',
        args: {
          filePath: '/mocked/root/dir/test.js',
          patch: 'invalid patch',
        },
      },
    ];
    const mockValidUpdateCall = [
      {
        name: 'updateFile',
        args: {
          filePath: '/mocked/root/dir/test.js',
          newContent: 'console.log("Updated content");',
        },
      },
    ];

    // Mock the first call to return the codegen summary
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockCodegenSummary);
    // Mock the second call to return an invalid patch
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockInvalidPatchCall);
    // Mock the third call (retry) to return a valid update
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockValidUpdateCall);

    // Mock fs.readFileSync to return some content
    vi.mocked(fs.readFileSync).mockReturnValue('Original content');

    // Mock diff.applyPatch to fail for the invalid patch
    vi.mocked(diff.applyPatch).mockReturnValue(false);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'vertex-ai',
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync).toHaveBeenCalledWith('/mocked/root/dir/test.js', 'utf-8');
    expect(diff.applyPatch).toHaveBeenCalledWith('Original content', 'invalid patch');
    expect(result).toEqual(mockValidUpdateCall);
  });

  it('should include image assets when vision flag is true', async () => {
    vi.mocked(cliParams).aiService = 'chat-gpt';
    vi.mocked(cliParams).vision = true;
    const mockImageAssets = {
      '/path/to/image1.png': { width: 100, height: 100, mimeType: 'image/png' },
      '/path/to/image2.jpg': { width: 200, height: 200, mimeType: 'image/png' },
    };
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("Vision test");' } },
    ];

    vi.mocked(getImageAssets).mockReturnValue(mockImageAssets);
    vi.mocked(chatGpt.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'chat-gpt',
        vision: true,
      }),
    );

    expect(chatGpt.generateContent).toHaveBeenCalled();
    const calls = vi.mocked(chatGpt.generateContent).mock.calls[0];
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          text: expect.stringContaining('Hello, GenAIcode'),
        }),
        expect.objectContaining({
          type: 'assistant',
          text: expect.stringContaining('I guess you have a task for me'),
        }),
        expect.objectContaining({
          type: 'user',
          functionResponses: expect.arrayContaining([
            { name: 'getImageAssets', content: JSON.stringify(mockImageAssets) },
          ]),
        }),
      ]),
    );
  });

  it('should include image data in the prompt when processing files with vision', async () => {
    vi.mocked(cliParams).aiService = 'chat-gpt';
    vi.mocked(cliParams).vision = true;
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            {
              filePath: '/mocked/root/dir/test.js',
              updateToolName: 'updateFile',
              contextImageAssets: ['/mocked/root/dir/image1.png', '/mocked/root/dir/image2.jpg'],
              prompt: 'Generate file update',
            },
          ],
          contextPaths: [],
          explanation: 'Mock summary',
        },
      },
    ];
    const mockUpdateCall = [
      {
        name: 'updateFile',
        args: {
          filePath: '/mocked/root/dir/test.js',
          newContent: 'console.log("Updated with vision");',
        },
      },
    ];

    vi.mocked(chatGpt.generateContent).mockResolvedValueOnce(mockCodegenSummary);
    vi.mocked(chatGpt.generateContent).mockResolvedValueOnce(mockUpdateCall);

    vi.mocked(fs.readFileSync).mockImplementation((path) => `mock-base64-data-for-${path}`);
    vi.mocked(mime.lookup).mockImplementation((path) => (path.endsWith('.png') ? 'image/png' : 'image/jpeg'));

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'chat-gpt',
        vision: true,
      }),
    );

    expect(chatGpt.generateContent).toHaveBeenCalledTimes(2);
    const secondCall = vi.mocked(chatGpt.generateContent).mock.calls[1];
    expect(secondCall[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          text: expect.stringContaining('Generate file update'),
          images: [
            {
              path: '/mocked/root/dir/image1.png',
              base64url: 'mock-base64-data-for-/mocked/root/dir/image1.png',
              mediaType: 'image/png',
            },
            {
              path: '/mocked/root/dir/image2.jpg',
              base64url: 'mock-base64-data-for-/mocked/root/dir/image2.jpg',
              mediaType: 'image/jpeg',
            },
          ],
        }),
      ]),
    );
  });

  it('should not include image assets when vision flag is false', async () => {
    vi.mocked(cliParams).aiService = 'chat-gpt';
    vi.mocked(cliParams).vision = false;
    const mockFunctionCalls = [
      { name: 'updateFile', args: { filePath: 'test.js', newContent: 'console.log("No vision test");' } },
    ];

    vi.mocked(chatGpt.generateContent).mockResolvedValueOnce(mockFunctionCalls);

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'chat-gpt',
      }),
    );

    expect(chatGpt.generateContent).toHaveBeenCalled();
    const calls = vi.mocked(chatGpt.generateContent).mock.calls[0];
    expect(calls[0]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          text: expect.stringContaining('I should also provide you with a summary of application image assets'),
        }),
      ]),
    );
  });

  it('should handle context optimization', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { filePath: '/mocked/root/dir/test.js', updateToolName: 'updateFile', prompt: 'Generate file' },
          ],
          contextPaths: ['/mocked/root/dir/context1.js', '/mocked/root/dir/context2.js'],
          explanation: 'Mock summary with context',
        },
      },
    ];
    const mockUpdateCall = [
      {
        name: 'updateFile',
        args: {
          filePath: '/mocked/root/dir/test.js',
          newContent: 'console.log("Updated with context");',
        },
      },
    ];

    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockCodegenSummary);
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockUpdateCall);

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'vertex-ai',
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(vertexAi.generateContent).mock.calls[0];
    expect(firstCall[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          functionResponses: [
            expect.objectContaining({
              name: 'getSourceCode',
              content: expect.any(String),
            }),
          ],
        }),
      ]),
    );
  });

  it('should handle disableContextOptimization flag', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).disableContextOptimization = true;
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { filePath: '/mocked/root/dir/test.js', updateToolName: 'updateFile', prompt: 'Generate file' },
          ],
          contextPaths: ['/mocked/root/dir/context1.js', '/mocked/root/dir/context2.js'],
          explanation: 'Mock summary without context optimization',
        },
      },
    ];
    const mockUpdateCall = [
      {
        name: 'updateFile',
        args: {
          filePath: '/mocked/root/dir/test.js',
          newContent: 'console.log("Updated without context optimization");',
        },
      },
    ];

    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockCodegenSummary);
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockUpdateCall);

    await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'vertex-ai',
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    const firstCall = vi.mocked(vertexAi.generateContent).mock.calls[0];
    expect(firstCall[0]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user',
          functionResponses: [
            expect.objectContaining({
              name: 'getSourceCode',
              content: expect.stringContaining('context1.js'),
            }),
          ],
        }),
      ]),
    );
  });

  it('should handle image generation requests', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).imagen = 'dall-e';
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { filePath: '/mocked/root/dir/image.png', updateToolName: 'generateImage', prompt: 'Generate file' },
          ],
          contextPaths: [],
          explanation: 'Mock summary with image generation',
        },
      },
    ];
    const mockGenerateImageCall = [
      {
        name: 'generateImage',
        args: {
          prompt: 'A test image',
          filePath: '/mocked/root/dir/image.png',
          width: 256,
          height: 256,
        },
      },
    ];
    const mockDownloadFileCall = [
      {
        name: 'downloadFile',
        args: {
          filePath: '/mocked/root/dir/image.png',
          explanation: 'Downloading generated image',
          downloadUrl: 'https://example.com/generated-image.png',
        },
      },
    ];

    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockCodegenSummary);
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockGenerateImageCall);
    vi.mocked(dalleService.generateImage).mockResolvedValue('https://example.com/generated-image.png');

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'vertex-ai',
        imagen: 'dall-e',
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(dalleService.generateImage).toHaveBeenCalledWith(
      'A test image',
      undefined,
      { width: 256, height: 256 },
      false,
    );
    expect(result).toEqual(expect.arrayContaining(mockDownloadFileCall));
  });

  it('should handle image generation failure', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    vi.mocked(cliParams).imagen = 'dall-e';
    const mockCodegenSummary = [
      {
        name: 'codegenSummary',
        args: {
          fileUpdates: [
            { filePath: '/mocked/root/dir/image.png', updateToolName: 'generateImage', prompt: 'Generate file' },
          ],
          contextPaths: [],
          explanation: 'Mock summary with image generation failure',
        },
      },
    ];
    const mockGenerateImageCall = [
      {
        name: 'generateImage',
        args: {
          prompt: 'A test image',
          filePath: '/mocked/root/dir/image.png',
          width: 256,
          height: 256,
        },
      },
    ];

    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockCodegenSummary);
    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockGenerateImageCall);
    vi.mocked(dalleService.generateImage).mockRejectedValue(new Error('Image generation failed'));

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'vertex-ai',
        imagen: 'dall-e',
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(2);
    expect(dalleService.generateImage).toHaveBeenCalledWith(
      'A test image',
      undefined,
      { width: 256, height: 256 },
      false,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'explanation',
          args: {
            text: expect.stringContaining('Failed to generate image: Image generation failed'),
          },
        }),
      ]),
    );
  });

  it('should handle unexpected response without codegen summary', async () => {
    vi.mocked(cliParams).aiService = 'vertex-ai';
    const mockUnexpectedResponse = [
      {
        name: 'updateFile',
        args: {
          filePath: '/mocked/root/dir/test.js',
          newContent: 'console.log("Unexpected response");',
        },
      },
    ];

    vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockUnexpectedResponse);

    const result = await promptService(
      GENERATE_CONTENT_FNS,
      GENERATE_IMAGE_FNS,
      getCodeGenPrompt({
        askQuestion: false,
        disableContextOptimization: true,
        explicitPrompt: 'testx',
        aiService: 'vertex-ai',
      }),
    );

    expect(vertexAi.generateContent).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockUnexpectedResponse);
  });

  describe('validateAndRecoverSingleResult', () => {
    it('should successfully recover from an invalid function call', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      const mockInvalidCall = [
        {
          name: 'codegenSummary',
          args: {
            files: [{ filePath: '/mocked/root/dir/test.js', updateToolName: 'updateFile' }],
            contextPaths: [],
            explanation: 'Mock summary',
          },
        },
      ];
      const mockValidCall = [
        {
          name: 'codegenSummary',
          args: {
            fileUpdates: [
              { filePath: '/mocked/root/dir/test.js', updateToolName: 'updateFile', prompt: 'Generate file' },
            ],
            contextPaths: [],
            explanation: 'Mock summary',
          },
        },
      ];

      vi.mocked(vertexAi.generateContent)
        .mockResolvedValueOnce(mockInvalidCall)
        .mockResolvedValueOnce(mockValidCall)
        .mockResolvedValueOnce([
          {
            name: 'updateFile',
            args: {
              filePath: '/mocked/root/dir/test.js',
              newContent: 'console.log("Unexpected response");',
            },
          },
        ]);

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt({
          askQuestion: false,
          disableContextOptimization: true,
          explicitPrompt: 'testx',
          aiService: 'vertex-ai',
        }),
      );

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(3);
      expect(result).toEqual([
        {
          args: {
            filePath: '/mocked/root/dir/test.js',
            newContent: 'console.log("Unexpected response");',
          },
          name: 'updateFile',
        },
      ]);
    });

    it('should handle unsuccessful recovery', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      const mockInvalidCall = [
        {
          name: 'updateFile',
          args: { filePath: '/mocked/root/dir/test.js', invalidArg: 'This should not be here' },
        },
      ];

      vi.mocked(vertexAi.generateContent)
        .mockResolvedValueOnce([
          {
            name: 'codegenSummary',
            args: {
              fileUpdates: [
                { filePath: '/mocked/root/dir/test.js', updateToolName: 'patchFile', prompt: 'Generate file' },
              ],
              contextPaths: [],
              explanation: 'Mock summary',
            },
          },
        ])
        .mockResolvedValueOnce(mockInvalidCall)
        .mockResolvedValueOnce(mockInvalidCall)
        .mockResolvedValueOnce(mockInvalidCall); // Second call also returns invalid result

      await expect(
        promptService(
          GENERATE_CONTENT_FNS,
          GENERATE_IMAGE_FNS,
          getCodeGenPrompt({
            askQuestion: false,
            disableContextOptimization: true,
            explicitPrompt: 'testx',
            aiService: 'vertex-ai',
          }),
        ),
      ).rejects.toThrow('Recovery failed');

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(4);
    });

    it('should not attempt recovery for multiple valid function calls', async () => {
      vi.mocked(cliParams).aiService = 'vertex-ai';
      const mockValidCalls = [
        {
          name: 'updateFile',
          args: { filePath: 'test1.js', newContent: 'console.log("File 1");' },
        },
        {
          name: 'updateFile',
          args: { filePath: 'test2.js', newContent: 'console.log("File 2");' },
        },
      ];

      vi.mocked(vertexAi.generateContent).mockResolvedValueOnce(mockValidCalls);

      const result = await promptService(
        GENERATE_CONTENT_FNS,
        GENERATE_IMAGE_FNS,
        getCodeGenPrompt({
          askQuestion: false,
          disableContextOptimization: true,
          explicitPrompt: 'testx',
          aiService: 'vertex-ai',
        }),
      );

      expect(vertexAi.generateContent).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockValidCalls);
    });
  });
});

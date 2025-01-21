import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFileUpdates } from './step-process-file-updates.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { FunctionDef } from '../../ai-service/common-types.js';
import { CodegenOptions, CodegenSummaryArgs } from '../../main/codegen-types.js';
import { getSourceCode } from '../../files/read-files.js';
import fs from 'fs';
import * as diff from 'diff';

// Mock dependencies
vi.mock('../../files/find-files.js', () => ({
  refreshFiles: vi.fn(),
}));

vi.mock('../../files/read-files.js', () => ({
  getSourceCode: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('diff', () => ({
  applyPatch: vi.fn(),
}));

vi.mock('../../main/config.js', () => ({
  rootDir: '/test',
  rcConfig: {
    rootDir: '/test',
    extensions: ['.js', '.ts', '.tsx', '.jsx'],
  },
  importantContext: {},
}));

describe('processFileUpdates', () => {
  const mockGenerateContentFn = vi.fn();
  const mockGenerateImageFn = vi.fn();
  const mockWaitIfPaused = vi.fn();

  // Mock data
  const mockPrompt: PromptItem[] = [{ type: 'user', text: 'test prompt' }];
  const mockFunctionDefs: FunctionDef[] = [
    {
      name: 'updateFile',
      description: 'Function for updating files',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          newContent: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['filePath', 'newContent', 'explanation'],
      },
    },
    {
      name: 'patchFile',
      description: 'Function for patching files',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          patch: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['filePath', 'patch', 'explanation'],
      },
    },
  ];

  const mockOptions: CodegenOptions = {
    aiService: 'vertex-ai',
    temperature: 0.7,
    askQuestion: false,
  };

  const mockCodegenSummary: FunctionCall<CodegenSummaryArgs> = {
    name: 'codegenSummary',
    args: {
      explanation: 'Test explanation',
      fileUpdates: [
        {
          filePath: '/test/file1.ts',
          updateToolName: 'updateFile',
          prompt: 'Update file 1',
        },
      ],
      contextPaths: ['/test/context.ts'],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWaitIfPaused.mockResolvedValue(undefined);
    vi.mocked(getSourceCode).mockReturnValue({});
    vi.mocked(fs.readFileSync).mockReturnValue('original content');
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(diff.applyPatch).mockReturnValue('patched content');
  });

  it('should process single file update successfully', async () => {
    const mockUpdateResult: FunctionCall = {
      name: 'updateFile',
      args: {
        filePath: '/test/file1.ts',
        newContent: 'updated content',
        explanation: 'Updated file',
      },
    };

    mockGenerateContentFn.mockResolvedValueOnce([mockUpdateResult]);

    const result = await processFileUpdates(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      mockOptions,
      mockCodegenSummary,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockUpdateResult);
    expect(mockWaitIfPaused).toHaveBeenCalledTimes(1);
  });

  it('should process multiple file updates', async () => {
    const mockMultipleFilesSummary: FunctionCall<CodegenSummaryArgs> = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test multiple files',
        fileUpdates: [
          { filePath: '/test/file1.ts', updateToolName: 'updateFile', prompt: 'Update 1' },
          { filePath: '/test/file2.ts', updateToolName: 'updateFile', prompt: 'Update 2' },
        ],
        contextPaths: [],
      },
    };

    const mockUpdate1: FunctionCall = {
      name: 'updateFile',
      args: { filePath: '/test/file1.ts', newContent: 'content1', explanation: 'Update 1' },
    };
    const mockUpdate2: FunctionCall = {
      name: 'updateFile',
      args: { filePath: '/test/file2.ts', newContent: 'content2', explanation: 'Update 2' },
    };

    mockGenerateContentFn.mockResolvedValueOnce([mockUpdate1]).mockResolvedValueOnce([mockUpdate2]);

    const result = await processFileUpdates(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      mockOptions,
      mockMultipleFilesSummary,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(2);
    expect(mockWaitIfPaused).toHaveBeenCalledTimes(2);
    expect(mockGenerateContentFn).toHaveBeenCalledTimes(2);
  });

  it('should handle image generation requests', async () => {
    const mockImageSummary: FunctionCall<CodegenSummaryArgs> = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test image generation',
        fileUpdates: [
          {
            filePath: '/test/image.png',
            updateToolName: 'generateImage',
            prompt: 'Generate test image',
          },
        ],
        contextPaths: [],
      },
    };

    const mockGenerateImageResult: FunctionCall = {
      name: 'generateImage',
      args: {
        prompt: 'Generate test image',
        filePath: '/test/image.png',
        width: 100,
        height: 100,
        explanation: 'Test image',
      },
    };

    mockGenerateContentFn.mockResolvedValueOnce([mockGenerateImageResult]);
    mockGenerateImageFn.mockResolvedValueOnce('/test/image.png');

    const result = await processFileUpdates(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      mockOptions,
      mockImageSummary,
      mockWaitIfPaused,
      mockGenerateImageFn,
    );

    expect(result).toHaveLength(2); // Original call + generated image result
    expect(mockGenerateImageFn).toHaveBeenCalledTimes(1);
  });

  it('should handle patch file verification', async () => {
    const mockPatchSummary: FunctionCall<CodegenSummaryArgs> = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test patch',
        fileUpdates: [
          {
            filePath: '/test/file.ts',
            updateToolName: 'patchFile',
            prompt: 'Patch test file',
          },
        ],
        contextPaths: [],
      },
    };

    const originalContent = 'original content';
    const patchContent = `Index: file.ts
===================================================================
--- file.ts
+++ file.ts
@@ -1,1 +1,1 @@
-original content
+patched content`;

    const mockPatchResult: FunctionCall = {
      name: 'patchFile',
      args: {
        filePath: '/test/file.ts',
        patch: patchContent,
        explanation: 'Test patch',
      },
    };

    // Mock file system operations
    vi.mocked(fs.readFileSync).mockReturnValue(originalContent);
    vi.mocked(diff.applyPatch).mockReturnValue('patched content');

    mockGenerateContentFn.mockResolvedValueOnce([mockPatchResult]);

    const result = await processFileUpdates(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      mockOptions,
      mockPatchSummary,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockPatchResult);
    expect(fs.readFileSync).toHaveBeenCalledWith('/test/file.ts', 'utf-8');
    expect(diff.applyPatch).toHaveBeenCalledWith(originalContent, patchContent);
  });

  it('should handle patch file verification failure and retry with updateFile', async () => {
    const mockPatchSummary: FunctionCall<CodegenSummaryArgs> = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test patch',
        fileUpdates: [
          {
            filePath: '/test/file.ts',
            updateToolName: 'patchFile',
            prompt: 'Patch test file',
          },
        ],
        contextPaths: [],
      },
    };

    const originalContent = 'original content';
    const invalidPatch = 'invalid patch content';

    const mockPatchResult: FunctionCall = {
      name: 'patchFile',
      args: {
        filePath: '/test/file.ts',
        patch: invalidPatch,
        explanation: 'Test patch',
      },
    };

    const mockUpdateResult: FunctionCall = {
      name: 'updateFile',
      args: {
        filePath: '/test/file.ts',
        newContent: 'updated content',
        explanation: 'Updated after patch failure',
      },
    };

    // Mock file system operations
    vi.mocked(fs.readFileSync).mockReturnValue(originalContent);
    vi.mocked(diff.applyPatch).mockReturnValue(false); // Simulate patch failure

    mockGenerateContentFn.mockResolvedValueOnce([mockPatchResult]).mockResolvedValueOnce([mockUpdateResult]);

    const result = await processFileUpdates(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      mockOptions,
      mockPatchSummary,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockUpdateResult);
    expect(fs.readFileSync).toHaveBeenCalledWith('/test/file.ts', 'utf-8');
    expect(diff.applyPatch).toHaveBeenCalledWith(originalContent, invalidPatch);
    expect(mockGenerateContentFn).toHaveBeenCalledTimes(2);
  });

  it('should update prompt with function calls and responses', async () => {
    const mockUpdateResult: FunctionCall = {
      name: 'updateFile',
      args: {
        filePath: '/test/file1.ts',
        newContent: 'updated content',
        explanation: 'Updated file',
      },
    };

    mockGenerateContentFn.mockResolvedValueOnce([mockUpdateResult]);

    const prompt: PromptItem[] = [{ type: 'user', text: 'test prompt' }];
    await processFileUpdates(
      mockGenerateContentFn,
      prompt,
      mockFunctionDefs,
      mockOptions,
      mockCodegenSummary,
      mockWaitIfPaused,
    );

    // Check if prompt was updated with function calls and responses
    expect(prompt).toHaveLength(3); // original + assistant + user response
    expect(prompt[1].type).toBe('assistant');
    expect(prompt[1].functionCalls).toBeDefined();
    expect(prompt[2].type).toBe('user');
    expect(prompt[2].functionResponses).toBeDefined();
  });
});

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
  let mockPrompt: PromptItem[];
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
        { id: '1', dependsOn: [], filePath: '/test/file1.ts', updateToolName: 'updateFile', prompt: 'Update file 1' },
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
    mockPrompt = [{ type: 'user', text: 'test prompt' }];
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

    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockUpdateResult }]);

    const result = await processFileUpdates(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      mockOptions,
      mockCodegenSummary,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining(mockUpdateResult));
    expect(mockWaitIfPaused).toHaveBeenCalledTimes(1);
  });

  it('should process multiple file updates', async () => {
    const mockMultipleFilesSummary: FunctionCall<CodegenSummaryArgs> = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test multiple files',
        fileUpdates: [
          { id: 'a1', dependsOn: [], filePath: '/test/file1.ts', updateToolName: 'updateFile', prompt: 'Update 1' },
          { id: 'a2', dependsOn: [], filePath: '/test/file2.ts', updateToolName: 'updateFile', prompt: 'Update 2' },
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

    mockGenerateContentFn
      .mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockUpdate1 }])
      .mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockUpdate2 }]);

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
            id: 'e1',
            dependsOn: [],
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
    const mockDownloadFileResult: FunctionCall = {
      // The result of image generation is a download call
      name: 'downloadFile',
      args: {
        downloadUrl: '/test/image.png',
        explanation: 'Downloading generated image',
        filePath: '/test/image.png',
      },
    };

    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockGenerateImageResult }]);
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

    expect(result).toHaveLength(2); // generateImage call + downloadFile call
    expect(result[0]).toEqual(expect.objectContaining(mockGenerateImageResult));
    expect(result[1]).toEqual(mockDownloadFileResult);
    expect(mockGenerateImageFn).toHaveBeenCalledTimes(1);
  });

  it('should handle patch file verification', async () => {
    const mockPatchSummary: FunctionCall<CodegenSummaryArgs> = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test patch',
        fileUpdates: [
          {
            id: 'r1',
            dependsOn: [],
            filePath: '/test/file.ts',
            updateToolName: 'patchFile',
            prompt: 'Patch test file',
          },
        ],
        contextPaths: [],
      },
    };

    const originalContent = 'original content';
    const patchContent = `Index: file.ts\n===================================================================\n--- file.ts\n+++ file.ts\n@@ -1,1 +1,1 @@\n-original content\n+patched content`;

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

    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockPatchResult }]);

    const result = await processFileUpdates(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      mockOptions,
      mockPatchSummary,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toEqual(mockPatchResult.name);
    // Verify that oldContent and newContent were added during verification
    expect(result[0].args).toEqual(
      expect.objectContaining({
        ...mockPatchResult.args,
        oldContent: originalContent,
        newContent: 'patched content',
      }),
    );
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
            id: 'v1',
            dependsOn: [],
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

    mockGenerateContentFn
      .mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockPatchResult }]) // Initial patch attempt
      .mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockUpdateResult }]); // Recovery update attempt

    const result = await processFileUpdates(
      mockGenerateContentFn,
      mockPrompt,
      mockFunctionDefs,
      mockOptions,
      mockPatchSummary,
      mockWaitIfPaused,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining(mockUpdateResult));
    expect(fs.readFileSync).toHaveBeenCalledWith('/test/file.ts', 'utf-8');
    expect(diff.applyPatch).toHaveBeenCalledWith(originalContent, invalidPatch);
    expect(mockGenerateContentFn).toHaveBeenCalledTimes(2); // Patch attempt + Update attempt
  });

  it('should update prompt with function calls and responses', async () => {
    const mockUpdateResult: FunctionCall = {
      name: 'updateFile',
      args: {
        id: 'f1',
        filePath: '/test/file1.ts',
        newContent: 'updated content',
        explanation: 'Updated file',
      },
    };

    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockUpdateResult }]);

    const prompt: PromptItem[] = [{ type: 'user', text: 'test prompt' }];
    await processFileUpdates(
      mockGenerateContentFn,
      prompt, // Pass the prompt array to be modified
      mockFunctionDefs,
      mockOptions,
      mockCodegenSummary,
      mockWaitIfPaused,
    );

    // Check if prompt was updated with function calls and responses
    expect(prompt).toHaveLength(5); // original user + assistant call + user response
    expect(prompt[3].type).toBe('assistant');
    expect(prompt[3].functionCalls).toEqual([expect.objectContaining(mockUpdateResult)]); // Check the content of the call
    expect(prompt[4].type).toBe('user');
    expect(prompt[4].functionResponses).toEqual([{ name: 'updateFile', call_id: undefined }]); // Check the response
  });

  it('should sort file updates based on dependencies', async () => {
    const fileUpdate1 = {
      id: 'u1',
      filePath: '/test/file1.ts',
      updateToolName: 'updateFile',
      prompt: 'Update 1',
      dependsOn: [],
    };
    const fileUpdate2 = {
      id: 'u2',
      filePath: '/test/file2.ts',
      updateToolName: 'updateFile',
      prompt: 'Update 2',
      dependsOn: ['3'],
    };
    const fileUpdate3 = {
      id: 'u3',
      filePath: '/test/file3.ts',
      updateToolName: 'updateFile',
      prompt: 'Update 3',
      dependsOn: ['1'],
    };

    const mockDependentSummary: FunctionCall<CodegenSummaryArgs> = {
      name: 'codegenSummary',
      args: {
        explanation: 'Test dependencies',
        fileUpdates: [
          fileUpdate2, // Intentionally out of order
          fileUpdate3,
          fileUpdate1,
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
    const mockUpdate3: FunctionCall = {
      name: 'updateFile',
      args: { filePath: '/test/file3.ts', newContent: 'content3', explanation: 'Update 3' },
    };

    mockGenerateContentFn
      .mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockUpdate1 }])
      .mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockUpdate3 }])
      .mockResolvedValueOnce([{ type: 'functionCall', functionCall: mockUpdate2 }]);

    const prompt = [...mockPrompt]; // Copy to avoid mutation across tests

    await processFileUpdates(
      mockGenerateContentFn,
      prompt,
      mockFunctionDefs,
      mockOptions,
      mockDependentSummary,
      mockWaitIfPaused,
    );

    const updateCalls = prompt
      .filter((item) => item.functionResponses?.[0].name === 'updateFile')
      .map((item) => item.text);
    expect(updateCalls).toEqual(['Update u1 applied.', 'Update u3 applied.', 'Update u2 applied.']);
    expect(mockGenerateContentFn).toHaveBeenCalledTimes(3); // One for each file update
  });
});

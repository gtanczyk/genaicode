import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionHandlerProps, IterateCall } from '../step-iterate-types.js';

// Mock dependencies before importing the handler
vi.mock('../../../../main/common/content-bus.js', () => ({
  putSystemMessage: vi.fn(),
  putAssistantMessage: vi.fn(),
}));

vi.mock('../../../../ai-service/files-api.js', () => ({
  getFilesApiProvider: vi.fn(),
}));

// Import after mocking
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFilesApiProvider } from '../../../../ai-service/files-api.js';
import { handlers } from '../step-iterate-handlers.js';

// Import the handler module to trigger registration
import './handle-code-execution.js';

const mockPutSystemMessage = vi.mocked(putSystemMessage);
const mockGetFilesApiProvider = vi.mocked(getFilesApiProvider);

describe('handleCodeExecution', () => {
  let mockGenerateContentFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContentFn = vi.fn();
    mockGetFilesApiProvider.mockReturnValue(undefined);
  });

  const getHandler = () => {
    const handler = handlers['codeExecution'];
    expect(handler).toBeDefined();
    return handler!;
  };

  const getProps = (args?: Record<string, unknown>): ActionHandlerProps =>
    ({
      iterateCall: {
        name: 'iterate',
        args: {
          actionType: 'codeExecution',
          message: 'Analyze this data',
          ...args,
        },
      } as unknown as IterateCall,
      prompt: [],
      options: { aiService: 'ai-studio' } as unknown as ActionHandlerProps['options'],
      generateContentFn: mockGenerateContentFn,
      generateImageFn: vi.fn(),
      waitIfPaused: () => Promise.resolve(),
    }) as ActionHandlerProps;

  it('should be registered as codeExecution handler', () => {
    expect(handlers['codeExecution']).toBeDefined();
  });

  it('should handle basic code execution without file I/O', async () => {
    mockGenerateContentFn.mockResolvedValueOnce([
      { type: 'text', text: 'Here is the result' },
      { type: 'executableCode', code: 'print("hello")', language: 'python' },
      { type: 'codeExecutionResult', outcome: 'OUTCOME_OK', output: 'hello' },
    ]);

    const handler = getHandler();
    const result = await handler(getProps());

    expect(result.breakLoop).toBe(false);
    expect(result.items).toHaveLength(1);

    const assistant = result.items[0].assistant;
    expect(assistant.text).toBe('Here is the result');
    expect(assistant.executableCode).toEqual({
      language: 'python',
      code: 'print("hello")',
    });
    expect(assistant.codeExecutionResult).toEqual({
      outcome: 'OUTCOME_OK',
      output: 'hello',
    });
  });

  it('should call generateContentFn with codeExecution enabled', async () => {
    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'text', text: 'done' }]);

    const handler = getHandler();
    await handler(getProps());

    expect(mockGenerateContentFn).toHaveBeenCalledTimes(1);
    const [, config] = mockGenerateContentFn.mock.calls[0];
    expect(config.expectedResponseType).toEqual({
      text: true,
      codeExecution: true,
      functionCall: false,
    });
  });

  it('should handle code execution with failed outcome', async () => {
    mockGenerateContentFn.mockResolvedValueOnce([
      { type: 'text', text: 'Error occurred' },
      { type: 'executableCode', code: 'raise Exception("fail")', language: 'python' },
      { type: 'codeExecutionResult', outcome: 'OUTCOME_FAILED', output: 'Exception: fail' },
    ]);

    const handler = getHandler();
    const result = await handler(getProps());

    expect(result.items[0].assistant.codeExecutionResult?.outcome).toBe('OUTCOME_FAILED');
    expect(result.items[0].assistant.codeExecutionResult?.output).toBe('Exception: fail');
  });

  it('should handle response with no code execution parts', async () => {
    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'text', text: 'Just text' }]);

    const handler = getHandler();
    const result = await handler(getProps());

    expect(result.items[0].assistant.text).toBe('Just text');
    expect(result.items[0].assistant.executableCode).toBeUndefined();
    expect(result.items[0].assistant.codeExecutionResult).toBeUndefined();
  });

  it('should upload files when filePaths provided and filesApi available', async () => {
    const mockFilesApi = {
      uploadFile: vi.fn().mockResolvedValue({
        fileId: 'file-123',
        filename: 'data.csv',
        size: 1024,
      }),
      downloadFile: vi.fn(),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };
    mockGetFilesApiProvider.mockReturnValue(mockFilesApi);

    mockGenerateContentFn.mockResolvedValueOnce([
      { type: 'text', text: 'Analyzed the file' },
      { type: 'codeExecutionResult', outcome: 'OUTCOME_OK', output: 'Success' },
    ]);

    const handler = getHandler();
    await handler(getProps({ filePaths: ['/path/to/data.csv'] }));

    expect(mockFilesApi.uploadFile).toHaveBeenCalledWith('/path/to/data.csv');
    expect(mockPutSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Uploaded file for code execution'));

    // Verify fileIds were passed to generateContentFn
    const [, config] = mockGenerateContentFn.mock.calls[0];
    expect(config.fileIds).toEqual(['file-123']);
    expect(config.uploadedFiles).toEqual([
      { fileId: 'file-123', filename: 'data.csv', originalPath: '/path/to/data.csv' },
    ]);
  });

  it('should cleanup uploaded files after execution', async () => {
    const mockFilesApi = {
      uploadFile: vi.fn().mockResolvedValue({
        fileId: 'file-456',
        filename: 'test.txt',
        size: 512,
      }),
      downloadFile: vi.fn(),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    };
    mockGetFilesApiProvider.mockReturnValue(mockFilesApi);

    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'text', text: 'done' }]);

    const handler = getHandler();
    await handler(getProps({ filePaths: ['/path/to/test.txt'] }));

    expect(mockFilesApi.deleteFile).toHaveBeenCalledWith('file-456');
  });

  it('should handle file upload failures gracefully', async () => {
    const mockFilesApi = {
      uploadFile: vi.fn().mockRejectedValue(new Error('Upload failed')),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
    };
    mockGetFilesApiProvider.mockReturnValue(mockFilesApi);

    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'text', text: 'done' }]);

    const handler = getHandler();
    const result = await handler(getProps({ filePaths: ['/path/to/bad-file.csv'] }));

    // Should not throw, just log a message
    expect(mockPutSystemMessage).toHaveBeenCalledWith(expect.stringContaining('Failed to upload'));
    expect(result.breakLoop).toBe(false);
  });

  it('should not pass fileIds when no files uploaded', async () => {
    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'text', text: 'done' }]);

    const handler = getHandler();
    await handler(getProps());

    const [, config] = mockGenerateContentFn.mock.calls[0];
    expect(config.fileIds).toBeUndefined();
    expect(config.uploadedFiles).toBeUndefined();
  });

  it('should handle output files in code execution result', async () => {
    const mockFilesApi = {
      uploadFile: vi.fn(),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
    };
    mockGetFilesApiProvider.mockReturnValue(mockFilesApi);

    mockGenerateContentFn.mockResolvedValueOnce([
      { type: 'text', text: 'Generated a file' },
      {
        type: 'codeExecutionResult',
        outcome: 'OUTCOME_OK',
        output: 'File created',
        outputFiles: [{ fileId: 'out-1', filename: 'output.csv', size: 2048, mimeType: 'text/csv' }],
      },
    ]);

    const handler = getHandler();
    const result = await handler(getProps());

    expect(result.items[0].assistant.codeExecutionResult?.outputFiles).toEqual([
      { fileId: 'out-1', filename: 'output.csv', size: 2048, mimeType: 'text/csv' },
    ]);
    expect(mockPutSystemMessage).toHaveBeenCalledWith(expect.stringContaining('output file: output.csv'));
  });

  it('should skip file operations when no filesApi available', async () => {
    mockGetFilesApiProvider.mockReturnValue(undefined);

    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'text', text: 'done' }]);

    const handler = getHandler();
    const result = await handler(getProps({ filePaths: ['/path/to/data.csv'] }));

    // Should work without errors, just skip file operations
    expect(result.breakLoop).toBe(false);
  });

  it('should handle cleanup failure gracefully', async () => {
    const mockFilesApi = {
      uploadFile: vi.fn().mockResolvedValue({
        fileId: 'file-789',
        filename: 'test.txt',
        size: 100,
      }),
      downloadFile: vi.fn(),
      deleteFile: vi.fn().mockRejectedValue(new Error('Delete failed')),
    };
    mockGetFilesApiProvider.mockReturnValue(mockFilesApi);

    mockGenerateContentFn.mockResolvedValueOnce([{ type: 'text', text: 'done' }]);

    const handler = getHandler();
    // Should not throw even if cleanup fails
    const result = await handler(getProps({ filePaths: ['/path/to/test.txt'] }));
    expect(result.breakLoop).toBe(false);
  });
});

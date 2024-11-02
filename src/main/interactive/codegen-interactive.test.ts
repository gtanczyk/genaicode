import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as common from './common.js';
import * as textPrompt from './text-prompt.js';
import * as taskFile from './task-file.js';
import * as selectAiService from './select-ai-service.js';
import * as configure from './configure.js';
import * as help from '../../cli/cli-options.js';
import '../../cli/cli-params.js';
import '../../files/cache-file.js';
import '../../files/read-files.js';
import '../../files/find-files.js';
import '../config.js';
import { runInteractiveMode } from './codegen-interactive.js';

// Mock all imported modules
vi.mock('../../cli/cli-params.js', () => ({
  disableExplanations: true,
}));
vi.mock('../config.js', () => ({ rcConfig: {}, sourceExtensions: [] }));
vi.mock('./common');
vi.mock('../../files/cache-file.js');
vi.mock('../../files/find-files.js', () => ({}));
vi.mock('../../files/read-files.js', () => ({}));
vi.mock('./text-prompt');
vi.mock('./task-file');
vi.mock('./process-comments');
vi.mock('./select-ai-service');
vi.mock('./configure');
vi.mock('../../cli/cli-options');
vi.mock('./codegen-worker.js');

describe('runInteractiveMode', () => {
  const mockOptions = { aiService: 'vertex-ai' } as const;

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock console.log to prevent output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle text prompt action', async () => {
    vi.spyOn(common, 'getUserAction').mockResolvedValueOnce('text_prompt').mockResolvedValueOnce('exit');
    await runInteractiveMode(mockOptions);
    expect(textPrompt.runTextPrompt).toBeCalled();
  });

  it('should handle task file action', async () => {
    vi.spyOn(common, 'getUserAction').mockResolvedValueOnce('task_file').mockResolvedValueOnce('exit');
    await runInteractiveMode(mockOptions);
    expect(taskFile.runTaskFile).toBeCalled();
  });

  it('should handle select AI service action', async () => {
    vi.spyOn(common, 'getUserAction').mockResolvedValueOnce('select_ai_service').mockResolvedValueOnce('exit');
    vi.spyOn(selectAiService, 'selectAiService').mockResolvedValueOnce('chat-gpt');
    await runInteractiveMode(mockOptions);
    expect(selectAiService.selectAiService).toHaveBeenCalledWith('vertex-ai');
  });

  it('should handle configure action', async () => {
    vi.spyOn(common, 'getUserAction').mockResolvedValueOnce('configure').mockResolvedValueOnce('exit');
    vi.spyOn(configure, 'getUserOptions').mockResolvedValueOnce({ ...mockOptions, dryRun: true });
    await runInteractiveMode(mockOptions);
    expect(configure.getUserOptions).toHaveBeenCalledWith(mockOptions);
  });

  it('should handle help action', async () => {
    vi.spyOn(common, 'getUserAction').mockResolvedValueOnce('help').mockResolvedValueOnce('exit');
    await runInteractiveMode(mockOptions);
    expect(help.printHelpMessage).toHaveBeenCalled();
  });

  it('should handle exit action', async () => {
    vi.spyOn(common, 'getUserAction').mockResolvedValueOnce('exit');
    await runInteractiveMode(mockOptions);
    expect(console.log).toHaveBeenCalledWith('Exiting Genaicode Interactive Mode. Goodbye!');
  });
});

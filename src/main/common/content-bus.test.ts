import { describe, it, expect } from 'vitest';
import { editMessage } from './content-bus.js';
import { ChatMessageType, ChatMessageFlags, ContentProps } from './content-bus-types.js';
import { PromptItem } from '../../ai-service/common-types.js';

describe('editMessage', () => {
  function createContentProps(overrides?: {
    promptItem?: Partial<PromptItem>;
    functionCalls?: Array<{ name: string; args: Record<string, unknown>; id?: string }>;
  }): ContentProps {
    const promptItem: PromptItem = {
      type: 'assistant',
      functionCalls: overrides?.functionCalls ?? [],
      ...overrides?.promptItem,
    };

    return {
      message: {
        id: 'msg-1',
        iterationId: 'iter-1',
        type: ChatMessageType.ASSISTANT,
        content: 'original content',
        timestamp: new Date(),
        data: { name: 'codegenPlanning', args: { problemAnalysis: 'old', codeChanges: 'old', affectedFiles: [] } },
        flags: [ChatMessageFlags.MESSAGE_EDITABLE],
      },
      data: undefined,
      promptItem,
    };
  }

  it('should return false when message is missing', () => {
    const content: ContentProps = {
      terminalEvent: {
        id: 'te-1',
        iterationId: 'iter-1',
        level: 'info',
        source: 'system',
        text: 'test',
        timestamp: new Date(),
      },
    };
    const result = editMessage(content, 'new content');
    expect(result).toBe(false);
  });

  it('should return false when promptItem is missing', () => {
    const content: ContentProps = {
      message: {
        id: 'msg-1',
        iterationId: 'iter-1',
        type: ChatMessageType.ASSISTANT,
        content: 'original',
        timestamp: new Date(),
      },
    };
    const result = editMessage(content, 'new content');
    expect(result).toBe(false);
  });

  it('should update message content and promptItem text', () => {
    const content = createContentProps();
    const result = editMessage(content, 'new content');

    expect(result).toBe(true);
    expect(content.message!.content).toBe('new content');
    expect(content.promptItem!.text).toBe('new content');
  });

  it('should not update content when newContent is empty string', () => {
    const content = createContentProps();
    const result = editMessage(content, '');

    expect(result).toBe(true);
    expect(content.message!.content).toBe('original content');
  });

  it('should update message data when newData is provided', () => {
    const content = createContentProps();
    const newData = {
      name: 'codegenPlanning',
      args: { problemAnalysis: 'new', codeChanges: 'new', affectedFiles: [] },
    };

    const result = editMessage(content, 'new content', newData);

    expect(result).toBe(true);
    expect(content.message!.data).toEqual(newData);
  });

  it('should update codegenPlanning function call args from newData.args', () => {
    const planningArgs = { problemAnalysis: 'old', codeChanges: 'old', affectedFiles: [] };
    const content = createContentProps({
      functionCalls: [
        { name: 'codegenPlanning', args: planningArgs as unknown as Record<string, unknown>, id: 'call-1' },
      ],
    });

    const newArgs = {
      problemAnalysis: 'updated',
      codeChanges: 'updated',
      affectedFiles: [{ filePath: 'a.ts', reason: 'test' }],
    };
    const newData = { name: 'codegenPlanning', args: newArgs };

    editMessage(content, 'content', newData);

    const call = content.promptItem!.functionCalls![0];
    expect(call.args).toEqual(newArgs);
    // Verify it's not the entire newData object
    expect(call.args).not.toHaveProperty('name');
  });

  it('should update codegenSummary function call args from newData.args', () => {
    const summaryArgs = { explanation: 'old', fileUpdates: [], contextPaths: [] };
    const content = createContentProps({
      functionCalls: [
        { name: 'codegenSummary', args: summaryArgs as unknown as Record<string, unknown>, id: 'call-1' },
      ],
    });

    const newArgs = {
      explanation: 'updated explanation',
      fileUpdates: [{ id: '1', prompt: 'test', filePath: 'b.ts', updateToolName: 'createFile' }],
      contextPaths: ['c.ts'],
    };
    const newData = { name: 'codegenSummary', args: newArgs };

    editMessage(content, 'content', newData);

    const call = content.promptItem!.functionCalls![0];
    expect(call.args).toEqual(newArgs);
    expect(call.args).not.toHaveProperty('name');
  });

  it('should not update function call args for unrelated function calls', () => {
    const originalArgs = { some: 'data' };
    const content = createContentProps({
      functionCalls: [{ name: 'otherFunction', args: { ...originalArgs }, id: 'call-1' }],
    });

    const newData = {
      name: 'codegenPlanning',
      args: { problemAnalysis: 'new', codeChanges: 'new', affectedFiles: [] },
    };
    editMessage(content, 'content', newData);

    const call = content.promptItem!.functionCalls![0];
    expect(call.args).toEqual(originalArgs);
  });

  it('should not update function call args when newData has no args property', () => {
    const originalArgs = { problemAnalysis: 'old', codeChanges: 'old', affectedFiles: [] };
    const content = createContentProps({
      functionCalls: [
        { name: 'codegenPlanning', args: { ...originalArgs } as unknown as Record<string, unknown>, id: 'call-1' },
      ],
    });

    const newData = { name: 'codegenPlanning' }; // No args property
    editMessage(content, 'content', newData);

    const call = content.promptItem!.functionCalls![0];
    expect(call.args).toEqual(originalArgs);
  });
});

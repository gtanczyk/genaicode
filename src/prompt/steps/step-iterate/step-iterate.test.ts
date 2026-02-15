import { describe, it, expect } from 'vitest';
import './step-iterate.js';
import { handlers } from './step-iterate-handlers.js';
import { ActionType } from './step-iterate-types.js';

describe('step-iterate', () => {
  it('should have handlers registered for all action types', () => {
    // Get all action types from the type definition
    const actionTypes: Record<ActionType, boolean> = {
      codeGeneration: true,
      sendMessage: true,
      generateImage: true,
      requestPermissions: true,
      requestFilesContent: true,
      removeFilesFromContext: true,
      confirmCodeGeneration: true,
      endConversation: true,
      contextOptimization: true,
      contextCompression: true,
      searchCode: true,
      updateFile: true,
      performAnalysis: true,
      createFile: true,
      pullAppContext: true,
      pullConsoleLogs: true,
      genaicodeHelp: true,
      pushAppContext: true,
      reasoningInference: true,
      requestFilesFragments: true,
      conversationGraph: true,
      readExternalFiles: true,
      exploreExternalDirectories: true,
      requestGitContext: true,
      runContainerTask: true,
      compoundAction: true,
      runProjectCommand: true,
      runBashCommand: true,
      webSearch: true,
      structuredQuestion: true,
      codeExecution: true,
    };

    // Check if each action type has a registered handler
    expect(Object.keys(actionTypes).sort()).toEqual(Object.keys(handlers).sort());
  });
});

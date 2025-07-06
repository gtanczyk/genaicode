import { FunctionCall } from '../ai-service/common-types.js';

/**
 * Types for mock responses
 */
export interface MockPlanningResponse {
  problemAnalysis: string;
  codeChanges: string;
  affectedFiles: Array<{
    filePath: string;
    reason: string;
    dependencies?: string[];
  }>;
}

export interface MockExecutionResponse {
  name: string;
  args: Record<string, unknown>;
}

export interface MockCodegenSummary {
  fileUpdates: Array<{
    filePath: string;
    updateToolName: string;
    prompt?: string;
  }>;
  contextPaths: string[];
  explanation: string;
}

/**
 * Creates a mock planning response
 */
export function createMockPlanningResponse(
  analysis: string = 'Mock analysis',
  changes: string = 'Mock changes',
  files: Array<{ filePath: string; reason: string }> = [],
): FunctionCall[] {
  return [
    {
      name: 'codegenPlanning',
      args: {
        problemAnalysis: analysis,
        codeChanges: changes,
        affectedFiles: files,
      },
    },
  ];
}

/**
 * Creates a mock codegen summary response
 */
export function createMockCodegenSummary(
  updates: Array<{ id: string; filePath: string; updateToolName: string; prompt?: string }> = [],
  paths: string[] = [],
  explanation: string = 'Mock explanation',
): FunctionCall[] {
  return [
    {
      name: 'codegenSummary',
      args: {
        fileUpdates: updates,
        contextPaths: paths,
        explanation,
      },
    },
  ];
}

/**
 * Creates a mock file update response
 */
export function createMockFileUpdate(name: string, args: Record<string, unknown> = {}): FunctionCall[] {
  return [{ name, args }];
}

/**
 * Creates a mock image generation response
 */
export function createMockImageGenerationResponse(
  prompt: string,
  filePath: string,
  width: number = 512,
  height: number = 512,
  explanation: string = 'Generate test image',
): FunctionCall[] {
  return [
    {
      name: 'generateImage',
      args: {
        prompt,
        filePath,
        width,
        height,
        explanation,
      },
    },
  ];
}

/**
 * Creates a sequence of mock responses for a complete test scenario
 */
export function createMockResponseSequence(
  planningResponse: FunctionCall[],
  summaryResponse: FunctionCall[],
  executionResponses: FunctionCall[][],
): FunctionCall[][] {
  return [planningResponse, summaryResponse, ...executionResponses];
}

/**
 * Common mock options used across tests
 */
export const mockOptions = {
  explicitPrompt: 'test',
  taskFile: undefined,
  allowFileCreate: false,
  allowFileDelete: false,
  allowDirectoryCreate: false,
  allowFileMove: false,
  vision: false,
  imagen: undefined,
  disableContextOptimization: true,
  temperature: 0.7,
  cheap: false,
  dryRun: false,
  verbose: false,
  requireExplanations: false,
  geminiBlockNone: undefined,
  contentMask: undefined,
  ignorePatterns: [],
  disableCache: undefined,
  disableAiServiceFallback: undefined,
  disableHistory: true,
  disableConversationSummary: true,
  isDev: false,
};

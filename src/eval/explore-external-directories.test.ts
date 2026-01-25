import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { PromptItem, ModelType, FunctionCall } from '../ai-service/common-types.js';
import { getSystemPrompt } from '../prompt/systemprompt.js';
import {
  INITIAL_GREETING,
  READY_TO_ASSIST,
  REQUEST_SOURCE_CODE,
  SOURCE_CODE_RESPONSE,
} from '../prompt/static-prompts.js';
import { exploreExternalDirectories as exploreExternalDirectoriesDef } from '../prompt/function-defs/explore-external-directories.js';
import { rcConfig } from '../main/config.js';
import { validateLLMContent } from './test-utils/llm-content-validate.js'; // Added import
import { LLMContentExpectation } from './test-utils/file-updates-verify.js'; // Added import for type

// Mock config to avoid issues with path resolution during tests
vi.mock('../main/config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../main/config.js')>();
  return {
    ...original,
    rcConfig: {
      ...original.rcConfig,
      rootDir: '/project', // Use consistent mock root dir
      ignorePaths: ['node_modules', '.git'],
    },
  };
});

// --- Mock Data ---
const MOCK_EXTERNAL_DIR_A = '/external-a';
const MOCK_EXTERNAL_MANY_DIR = '/external-many';
const MANY_FILES = Array.from({ length: 15 }, (_, i) => path.join(MOCK_EXTERNAL_MANY_DIR, `file_${i + 1}.txt`));
const SYNTHESIS_FILE_COUNT_THRESHOLD = 10; // Threshold from handler

// --- Test Suite ---
describe.each([{ model: 'Gemini Flash', generateContent: generateContentAiStudio, modelType: ModelType.CHEAP }])(
  'Explore External Directories Prompt Validation: $model',
  ({ generateContent, modelType }) => {
    it('should generate the correct prompt for inferring exploration arguments and validate the reason', async () => {
      const userPromptText = `I need to check the contents of the logs directory located at ${MOCK_EXTERNAL_DIR_A}`;
      const assistantMessage = `Okay, I will look into ${MOCK_EXTERNAL_DIR_A} for the logs. Is this correct?`;

      // Conversation history before the handler is called
      const initialPrompt: PromptItem[] = [
        { type: 'systemPrompt', systemPrompt: getSystemPrompt(rcConfig, { askQuestion: true }) },
        { type: 'user', text: INITIAL_GREETING },
        { type: 'assistant', text: REQUEST_SOURCE_CODE, functionCalls: [{ name: 'getSourceCode' }] },
        {
          type: 'user',
          text: SOURCE_CODE_RESPONSE,
          functionResponses: [{ name: 'getSourceCode', content: JSON.stringify({}) }],
        },
        { type: 'assistant', text: READY_TO_ASSIST },
        { type: 'user', text: userPromptText },
        {
          type: 'assistant',
          text: assistantMessage,
          functionCalls: [
            {
              id: 'ask_q_1',
              name: 'iterate',
              args: {
                actionType: 'exploreExternalDirectories',
                message: assistantMessage,
              },
            },
          ],
        },
      ];

      // Expected prompt for argument inference
      const expectedInferencePrompt: PromptItem[] = [
        ...initialPrompt,
        {
          type: 'user',
          text: 'Given the conversation, identify the directories, reason, and any exploration parameters (recursive, depth, searchPhrases, maxResults) for exploring external directories.',
        },
      ];

      // --- Verification ---
      const result = await generateContent(
        expectedInferencePrompt,
        {
          functionDefs: [exploreExternalDirectoriesDef],
          modelType,
          expectedResponseType: { text: false, functionCall: true, media: false },
          requiredFunctionName: exploreExternalDirectoriesDef.name, // Ensure the correct function is called
        },
        {},
      );

      console.log('Inference Result:', JSON.stringify(result, null, 2));

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('functionCall');
      const functionCall = result[0] as { type: 'functionCall'; functionCall: FunctionCall }; // Type assertion
      expect(functionCall.functionCall.name).toBe(exploreExternalDirectoriesDef.name);

      const args = functionCall.functionCall.args as {
        directories: string[];
        reason: string;
        recursive?: boolean;
        depth?: number;
        searchPhrases?: string[];
        maxResults?: number;
      };

      // Verify basic argument structure and content
      expect(args).toBeDefined();
      expect(args.directories).toBeInstanceOf(Array);
      expect(args.directories).toContain(MOCK_EXTERNAL_DIR_A);
      expect(args.reason).toBeTypeOf('string');
      expect(args.reason.length).toBeGreaterThan(5); // Basic check for a meaningful reason

      // Validate the inferred reason using LLM
      const reasonExpectation: LLMContentExpectation = {
        description: 'The reason should explain why the directory needs to be explored based on the user prompt.',
        requiredElements: ['logs', 'check contents', MOCK_EXTERNAL_DIR_A], // Concepts expected in the reason
        tone: 'explanatory',
      };

      const validationResult = await validateLLMContent(generateContent, args.reason, reasonExpectation, {
        cheap: true,
      });
      expect(validationResult, `Reason validation failed: ${validationResult}`).toBe(true);
    });

    it('should generate the correct prompt for synthesizing exploration results and validate the synthesis', async () => {
      const reason = 'Find all text files for analysis';
      const filePaths = MANY_FILES; // Exceeds threshold

      expect(filePaths.length).toBeGreaterThan(SYNTHESIS_FILE_COUNT_THRESHOLD);

      // Expected prompt for synthesis
      const expectedSynthesisPrompt: PromptItem[] = [
        {
          type: 'user',
          text: `You explored directories and found ${filePaths.length} files because: ${reason}.\nFiles:\n${filePaths.join('\n')}\n\nBased on this reason, provide a concise and helpful output. Choose the most suitable format from summary, categorized list, or plain file list.`,
        },
      ];

      // --- Verification ---
      const result = await generateContent(
        expectedSynthesisPrompt,
        {
          // No function defs needed for text synthesis
          modelType,
          expectedResponseType: { text: true, functionCall: false, media: false },
        },
        {},
      );

      console.log('Synthesis Result:', JSON.stringify(result, null, 2));

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('text');
      const synthesisText = result.find((part) => part.type === 'text')?.text;
      expect(synthesisText?.length).toBeGreaterThan(10); // Basic check

      // Validate the synthesized output using LLM
      const synthesisExpectation: LLMContentExpectation = {
        description: 'The synthesis should summarize the found files based on the provided reason.',
        requiredElements: ['found', `${filePaths.length} files`, 'analysis', 'text files'], // Concepts expected
        forbiddenElements: ['error', 'failed'], // Should not indicate failure
        tone: 'informative',
        minLength: 20,
      };

      const validationResult = await validateLLMContent(generateContent, synthesisText ?? '', synthesisExpectation, {
        cheap: true,
      });
      expect(validationResult, `Synthesis validation failed: ${validationResult}`).toBe(true);
    });
  },
);

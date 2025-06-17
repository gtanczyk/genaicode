import { describe, it, expect, vi } from 'vitest';
import { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';
import { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';
import { generateContent as generateContentOpenAI } from '../ai-service/openai.js';
import { getFunctionDefs } from '../prompt/function-calling.js';
import { FunctionCall, PromptItem } from '../ai-service/common-types.js';
import { ModelType } from '../ai-service/common-types.js';
import { MOCK_SOURCE_CODE_DEPENDENCIES } from './data/mock-source-code-dependencies.js';
import {
  MOCK_SOURCE_CODE_DEPENDENCIES_EXPECTED,
  DEPENDENCY_EXTRACTION_TEST_CASES,
} from './data/mock-source-code-dependencies-expected.js';
import { validateLLMContent } from './test-utils/llm-content-validate.js';
import { retryGenerateContent } from './test-utils/generate-content-retry.js';
import { updateServiceConfig } from '../ai-service/service-configurations.js';
import { SummaryInfo } from '../files/summary-cache.js';
import { DependencyInfo } from '../files/source-code-types.js';
import { getSummarizationPrefix } from '../prompt/steps/step-summarization.js';
import { generateFileId } from '../files/file-id-utils.js';

// Set longer timeout for LLM operations
vi.setConfig({
  testTimeout: 3 * 60000,
});

describe.each([
  {
    model: 'Gemini Flash',
    generateContent: generateContentAiStudio,
    serviceConfigUpdate: [
      'ai-studio',
      {
        modelOverrides: {
          cheap: 'gemini-2.5-flash',
        },
      },
    ] as Parameters<typeof updateServiceConfig>,
  },
  { model: 'Claude Haiku', generateContent: generateContentAnthropic },
  { model: 'GPT-4o mini', generateContent: generateContentOpenAI },
])('Step Summarization: $model', ({ generateContent, serviceConfigUpdate }) => {
  if (serviceConfigUpdate) {
    updateServiceConfig(...serviceConfigUpdate);
  }

  // Wrap generateContent with retry mechanism
  generateContent = retryGenerateContent(generateContent);

  describe('Dependency Extraction', () => {
    it.each(DEPENDENCY_EXTRACTION_TEST_CASES)('$name', async ({ key, description }) => {
      const mockSource = MOCK_SOURCE_CODE_DEPENDENCIES[key].map((item) => ({
        ...item,
        fileId: generateFileId(item.path),
      }));
      // Prepare prompt items for testing
      const prompt: PromptItem[] = getSummarizationPrefix(
        mockSource.filter((item) => item.content !== null),
        mockSource.map((item) => item.path),
      );

      // Execute summarization
      const [setSummariesCall] = (
        await generateContent(
          prompt,
          {
            functionDefs: getFunctionDefs(),
            requiredFunctionName: 'setSummaries',
            temperature: 0.2,
            modelType: ModelType.CHEAP,
            expectedResponseType: {
              text: false,
              functionCall: true,
              media: false,
            },
          },
          {},
        )
      )
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as [
        FunctionCall<{ summaries: (SummaryInfo & { dependencies?: DependencyInfo[] })[] }>,
      ];

      console.log('setSummariesCall', JSON.stringify(setSummariesCall.args, null, 2));

      // Verify the response
      expect(setSummariesCall).toBeDefined();
      expect(setSummariesCall.name).toBe('setSummaries');
      expect(setSummariesCall.args).toBeDefined();
      expect(setSummariesCall.args!.summaries).toBeDefined();
      expect(setSummariesCall.args!.summaries).toHaveLength(mockSource.filter((item) => item.content !== null).length);

      const result = setSummariesCall.args!.summaries[0];
      expect(result).toBeDefined();

      // Validate dependencies using helper function
      const validationResult = await validateLLMContent(
        generateContent,
        JSON.stringify(result.dependencies),
        {
          description,
          requiredElements: MOCK_SOURCE_CODE_DEPENDENCIES_EXPECTED[key].dependencies.map((dep) => dep.path),
          tone: 'technical',
        },
        { cheap: true },
      );

      // If validation fails, the result will be a string with the reason
      expect(validationResult).toBe(true);

      // Verify that the dependencies match exactly
      const expectedDependencies = MOCK_SOURCE_CODE_DEPENDENCIES_EXPECTED[key].dependencies;
      expect(result.dependencies).toHaveLength(expectedDependencies.length);

      // Sort both arrays to ensure consistent comparison
      const sortedExpected = [...expectedDependencies].sort((a, b) => a.path.localeCompare(b.path));
      const sortedActual = [...(result.dependencies ?? [])].sort((a, b) => a.path.localeCompare(b.path));

      sortedExpected.forEach((expectedDep, index) => {
        expect(sortedActual[index]).toEqual(expectedDep);
      });
    });
  });
});

import { GenerateContentFunction, PromptItem, FunctionCall } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getSourceCode, SourceCodeMap } from '../../files/read-files.js';
import { functionDefs } from '../function-calling.js';
import { StepResult } from './steps-types.js';
import { estimateTokenCount } from '../token-estimator.js';

interface FileRelevance {
  path: string;
  summary: string;
  relevance: number;
}

const OPTIMIZATION_PROMPT = `You're correct, we need to optimize the context for code generation. Please perform the following tasks and respond by calling the \`optimizeContext\` function with the appropriate arguments:

1. **Summarization**:
   - For each file listed below, provide a **brief one-sentence summary** of its content.
   - The summary should accurately reflect the main purpose or functionality of the file.
   - **Use only the content provided**; do not infer or assume additional information.

2. **Relevance Rating**:
   - Rate the **relevance** of each file to the user's prompt on a scale from **0 to 1**.
     - **0** means **not relevant at all**.
     - **1** means **highly relevant**.
   - Base the relevance rating solely on the information in the user's prompt and the file's content.

3. **Function Call Response**:
   - Respond by **calling the \`optimizeContext\` function**.
   - The function should have the following parameters:
     - \`"userPrompt"\`: The user's original prompt.
     - \`"files"\`: An array of objects, each containing:
       - \`"path"\`: The file path.
       - \`"summary"\`: The one-sentence summary of the file.
       - \`"relevance"\`: The relevance rating as a number between 0 and 1.

**Important Guidelines**:

- **Do not include** any information not present in the file content.
- **Avoid assumptions or hallucinations**; stick strictly to the provided data.
- Ensure the **function call is properly formatted** and **valid**.

**Files to Analyze**:\n`;

export async function executeStepContextOptimization(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  sourceCode: Record<string, { content: string | null }>,
  options: CodegenOptions,
): Promise<StepResult> {
  const optimizationPrompt: PromptItem[] = [
    ...prompt,
    {
      type: 'assistant',
      text: 'Thank you for describing the task, I have noticed you have provided a very large context for your question. The amount of source code is very big in particular. Can we do something about it?',
    },
    {
      type: 'user',
      text: `${OPTIMIZATION_PROMPT}:\n${Object.entries(sourceCode)
        .map(
          ([path, { content }]) => `${path}: ${content ? content.substring(0, 200) + '...' : 'Content not available'}`,
        )
        .join('\n\n')}`,
    },
  ];

  try {
    const result = await generateContentFn(optimizationPrompt, functionDefs, 'optimizeContext', 0.2, true, options);

    const fileRelevance = parseOptimizationResult(result);

    if (!fileRelevance || fileRelevance.length === 0) {
      putSystemMessage(
        'Warning: Context optimization failed to produce useful summaries. Proceeding with full context.',
      );
      return StepResult.CONTINUE;
    }

    const tokensBefore = estimateTokenCount(JSON.stringify(sourceCode));

    putSystemMessage('Context optimization in progress.', fileRelevance);

    const optimizedSourceCode = optimizeSourceCode(
      sourceCode,
      getSourceCode({ forceAll: true }, options),
      fileRelevance,
    );

    const tokensAfter = estimateTokenCount(JSON.stringify(optimizedSourceCode));
    const percentageReduced = ((tokensBefore - tokensAfter) / tokensBefore) * 100;

    // Update the getSourceCode function response in the prompt
    const getSourceCodeResponse = prompt.find(
      (item) => item.type === 'user' && item.functionResponses?.some((resp) => resp.name === 'getSourceCode'),
    );

    if (getSourceCodeResponse && getSourceCodeResponse.functionResponses) {
      const sourceCodeResponseIndex = getSourceCodeResponse.functionResponses.findIndex(
        (resp) => resp.name === 'getSourceCode',
      );
      if (sourceCodeResponseIndex !== -1) {
        getSourceCodeResponse.functionResponses[sourceCodeResponseIndex].content = JSON.stringify(optimizedSourceCode);
      }
    }

    putSystemMessage('Context optimization completed successfully.', {
      tokensBefore,
      tokensAfter,
      percentageReduced: percentageReduced.toFixed(2) + '%',
    });
    return StepResult.CONTINUE;
  } catch (error) {
    putSystemMessage('Warning: Context optimization failed. Proceeding with full context.');
    console.error('Context optimization error:', error);
    return StepResult.CONTINUE;
  }
}

function parseOptimizationResult(result: FunctionCall[]): FileRelevance[] | null {
  const explanationCall = result.find((call) => call.name === 'optimizeContext');
  if (!explanationCall || !explanationCall.args || !explanationCall.args.files) {
    return null;
  }

  try {
    return explanationCall.args.files as FileRelevance[];
  } catch (error) {
    console.error('Failed to parse optimization result:', error);
    return null;
  }
}

function optimizeSourceCode(
  sourceCode: Record<string, { content: string | null }>,
  fullSourceCode: SourceCodeMap,
  fileRelevance: FileRelevance[],
): Record<string, { content: string | null; summary?: string }> {
  const optimizedSourceCode: Record<string, { content: string | null; summary?: string }> = {};

  for (const [path, { content }] of Object.entries(sourceCode)) {
    const relevanceInfo = fileRelevance.find((file) => file.path === path);
    if (relevanceInfo && relevanceInfo.relevance > 0.6) {
      optimizedSourceCode[path] = {
        content: content ?? fullSourceCode[path]?.content ?? null,
        summary: relevanceInfo.summary,
      };
    } else {
      optimizedSourceCode[path] = {
        content: null,
        summary: relevanceInfo ? relevanceInfo.summary : undefined,
      };
    }
  }

  return optimizedSourceCode;
}

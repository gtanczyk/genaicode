import { GenerateContentFunction, PromptItem, FunctionCall, GenerateContentArgs } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getSourceCode, SourceCodeMap } from '../../files/read-files.js';
import { getFunctionDefs } from '../function-calling.js';
import { StepResult } from './steps-types.js';
import { estimateTokenCount } from '../token-estimator.js';
import { getSummary } from './step-summarization.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { getSourceCodeResponse } from './steps-utils.js';

const OPTIMIZATION_PROMPT = `You're correct, we need to optimize the context for code generation. Please perform the following tasks and respond by calling the \`optimizeContext\` function with the appropriate arguments:

1. **Relevance and Token Cost Evaluation**:
   - Rate the **relevance** of each file to the user's prompt on a scale from **0 to 1**, using the following guidelines:
     - **0.0 – 0.3 (Not Relevant)**: The file has no apparent connection to the user's prompt.
     - **0.3 – 0.7 (Somewhat Relevant)**: The file has minor or indirect relevance to the prompt.
     - **0.7 – 0.9 (Moderately Relevant)**: The file is related and could contribute to addressing the prompt.
     - **0.9 – 1.0 (Highly Relevant)**: The file is directly related and is important for addressing the prompt.
   - **Evaluation Criteria**:
     - **Keyword Matching**: Does the file contain keywords or topics mentioned in the user's prompt?
     - **Functional Alignment**: Does the file implement features or functionalities requested by the user?
     - **Dependency**: Is the file a dependency of other relevant modules?
   - Prioritize files with higher relevance scores, but be mindful of the total token count.
   - Consider the cost of adding more tokens; prioritize files where the relevance justifies the token usage.

2. **Token-Aware Optimization**:
   - Aim to optimize the context: less relevant files with higher token count should not be added to the context
   - Do not add irrelevant files to context
   - The goal is to have as much as possible of high relevancy files in the context while keeping the total token count reasonably low

3. **Function Call Response**:
   - Respond by **calling the \`optimizeContext\` function**.
   - The function should have the following parameters:
     - \`"userPrompt"\`: The user's original prompt.
     - \`"optimizedContext"\`: An array of objects, each containing:
       - \`"path"\`: The absolute file path.
       - \`"relevance"\`: The calculated relevance score (0 to 1).
       - \`"tokenCount"\`: The token count for the file.

**Important Guidelines**:
- **Only include files that are mentioned in \`getSourceCode\` function responses**. **Do not add any other files**.
- **Do not infer or guess additional files**.
- **Evaluate each file individually** based on the criteria above.
- **Avoid assumptions or hallucinations**; stick strictly to the provided data.
- Ensure the **function call is properly formatted** and **valid**.
- **Provide the response in valid JSON format**.
- **Do not include any extra text** outside of the function call.
- **Ensure the JSON is properly formatted** and **does not contain strings representing JSON** (i.e., do not stringify the JSON, do not wrap strings into quotes).
- **Do not return files which are not relevant to the user prompt. Use relevance rating to judge that**

**Example of valid Function Call**:

\`\`\`json
{
  "function": "optimizeContext",
  "arguments": {
    "userPrompt": "Please review the helper modules.",
    "optimizedContext": [
      {
        "path": "/home/src/utils/helpers.js",
        "relevance": 0.9,
        "tokenCount": 500
      },
      {
        "path": "/home/src/utils/math.js",
        "relevance": 0.8,
        "tokenCount": 300
      }
    ]
  }
}
\`\`\`

Now could you please analyze the source code and return me the optimized context?
`;

const BATCH_SIZE = 100;
const MAX_TOTAL_TOKENS = 10000;

export async function executeStepContextOptimization(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<StepResult> {
  const fullSourceCode = getSourceCode({ forceAll: true }, options);
  const sourceCodeResponse = getSourceCodeResponse(prompt);
  if (!sourceCodeResponse || !sourceCodeResponse.content) {
    console.warn('Could not find source code response, something is wrong, but lets continue anyway.');
    return StepResult.CONTINUE;
  }

  const sourceCode = JSON.parse(sourceCodeResponse.content) as SourceCodeMap;
  const sourceCodeEntries = Object.entries(sourceCode);

  // Lets remove source code from the context, because we will be providing it below, so lets not duplicate (and save some tokens)
  const sourceCodeResponseContent = sourceCodeResponse.content;
  sourceCodeResponse.content = '{}';

  try {
    putSystemMessage('Context optimization is starting');

    const totalFiles = sourceCodeEntries.length;
    const batchCount = Math.ceil(totalFiles / BATCH_SIZE);
    const optimizedContext = new Set<string>();

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      const start = batchIndex * BATCH_SIZE;
      const end = Math.min((batchIndex + 1) * BATCH_SIZE, totalFiles);
      const batchSourceCode = Object.fromEntries(
        sourceCodeEntries.filter(([path], index) => optimizedContext.has(path) || (index >= start && index <= end)),
      );

      const optimizationPrompt: PromptItem[] = [
        ...prompt,
        {
          type: 'assistant',
          text: 'Thank you for describing the task, I have noticed you have provided a very large context for your question. The amount of source code is very big in particular. Can we do something about it?',
          functionCalls: [
            { id: 'get_batch_source', name: 'getSourceCode', args: { filePaths: Object.keys(batchSourceCode) } },
          ],
        },
        {
          type: 'user',
          text: OPTIMIZATION_PROMPT,
          functionResponses: [
            { call_id: 'get_batch_source', name: 'getSourceCode', content: JSON.stringify(batchSourceCode) },
          ],
        },
      ];

      const request: GenerateContentArgs = [
        optimizationPrompt,
        getFunctionDefs(),
        'optimizeContext',
        0.2,
        true,
        options,
      ];
      let result = await generateContentFn(...request);
      result = await validateAndRecoverSingleResult(request, result, generateContentFn);

      const batchOptimized = parseOptimizationResult(result);
      if (!batchOptimized) {
        putSystemMessage(
          `Warning: Context optimization failed to produce useful summaries for batch ${batchIndex + 1}. We need to abort.`,
        );
        return StepResult.BREAK;
      }

      optimizedContext.clear();
      batchOptimized.forEach((path) => optimizedContext.add(path));
    }

    if (optimizedContext.size === 0) {
      // Restore the original context
      sourceCodeResponse.content = sourceCodeResponseContent;

      putSystemMessage(
        'Warning: Context optimization failed to produce useful summaries for all batches. Proceeding with current context.',
      );
      return StepResult.CONTINUE;
    }

    const tokensBefore = estimateTokenCount(JSON.stringify(fullSourceCode));

    putSystemMessage('Context optimization in progress.', Array.from(optimizedContext));

    const optimizedSourceCode = optimizeSourceCode(sourceCode, fullSourceCode, Array.from(optimizedContext));

    const tokensAfter = estimateTokenCount(JSON.stringify(optimizedSourceCode));
    const percentageReduced = ((tokensBefore - tokensAfter) / tokensBefore) * 100;

    // Update the getSourceCode function response in the prompt
    sourceCodeResponse.content = JSON.stringify(optimizedSourceCode);

    putSystemMessage('Context optimization completed successfully.', {
      tokensBefore,
      tokensAfter,
      percentageReduced: percentageReduced.toFixed(2) + '%',
    });
    return StepResult.CONTINUE;
  } catch (error) {
    putSystemMessage('Error: Context optimization failed. This is unexpected.');
    console.error('Context optimization error:', error);
    return StepResult.BREAK;
  }
}

function parseOptimizationResult(calls: FunctionCall[]): string[] | null {
  const optimizeCall = calls.find((call) => call.name === 'optimizeContext');
  if (!optimizeCall || !optimizeCall.args || !optimizeCall.args.optimizedContext) {
    return null;
  }

  let totalTokens = 0;
  const result: string[] = [];

  for (const item of (
    optimizeCall.args.optimizedContext as { relevance: number; filePath: string; tokenCount: number }[]
  ).sort((a, b) => (a.relevance > b.relevance ? -1 : 1))) {
    if (item.relevance < 0.5) {
      break;
    }

    totalTokens += item.tokenCount;
    result.push(item.filePath);

    if (totalTokens > MAX_TOTAL_TOKENS && item.relevance < 0.7) {
      break;
    }
  }

  return result;
}

function optimizeSourceCode(
  sourceCode: SourceCodeMap,
  fullSourceCode: SourceCodeMap,
  optimizedContext: string[],
): SourceCodeMap {
  const optimizedSourceCode: SourceCodeMap = {};

  for (const [path] of Object.entries(sourceCode)) {
    const isContext = optimizedContext.includes(path);
    const summary = getSummary(path);
    if (isContext) {
      optimizedSourceCode[path] = {
        content: ('content' in fullSourceCode[path] ? fullSourceCode[path]?.content : undefined) ?? null,
        ...summary,
      };
    } else {
      optimizedSourceCode[path] = summary
        ? { ...summary }
        : {
            content: null,
          };
    }
  }

  return optimizedSourceCode;
}

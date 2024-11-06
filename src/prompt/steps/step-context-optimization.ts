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
import { getSourceCodeTree, parseSourceCodeTree, SourceCodeTree } from '../../files/source-code-tree.js';

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
       - \`"filePath"\`: The absolute file path.
       - \`"relevance"\`: The calculated relevance score (0 to 1).

**Important Guidelines**:
- **Only include files that are mentioned in \`getSourceCode\` function response**. **Do not add any other files**.
- **Do not infer or guess additional files**.
- **Evaluate each file individually** based on the criteria above.
- **Avoid assumptions or hallucinations**; stick strictly to the provided data.
- Ensure the **function call is properly formatted** and **valid**.
- **Provide the response in valid JSON format**.
- **Do not include any extra text** outside of the function call.
- **Ensure the JSON is properly formatted** and **does not contain strings representing JSON** (i.e., do not stringify the JSON, do not wrap strings into quotes).
- **Do not return files which are not relevant to the user prompt. Use relevance rating to judge that**
- **Formulate full file paths correctly using directoryPath and filePath from the \`getSourceCode\` function response**.

**Example of valid Function Call**:

\`\`\`json
{
  "function": "optimizeContext",
  "arguments": {
    "userPrompt": "Please review the helper module.",
    "optimizedContext": [
      {
        "path": "/home/src/utils/helpers.js",
        "relevance": 0.9,
      },
      {
        "path": "/home/src/utils/math.js",
        "relevance": 0.4,
      }
    ]
  }
}
\`\`\`

Now could you please analyze the source code and return me the optimized context?
`;

// const BATCH_SIZE = 100;
const MAX_TOTAL_TOKENS = 10000;

export async function executeStepContextOptimization(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<StepResult> {
  const fullSourceCode = getSourceCode({ forceAll: true }, options);
  const tokensBefore = estimateTokenCount(JSON.stringify(fullSourceCode));

  if (tokensBefore < MAX_TOTAL_TOKENS) {
    putSystemMessage('Context optimization is not needed, because the code base is small.');
    return StepResult.CONTINUE;
  }

  const sourceCodeResponse = getSourceCodeResponse(prompt);
  if (!sourceCodeResponse || !sourceCodeResponse.content) {
    console.warn('Could not find source code response, something is wrong, but lets continue anyway.');
    return StepResult.CONTINUE;
  }

  const sourceCode = parseSourceCodeTree(JSON.parse(sourceCodeResponse.content) as SourceCodeTree);

  try {
    putSystemMessage('Context optimization is starting');

    const optimizationPrompt: PromptItem[] = [
      ...prompt,
      {
        type: 'assistant',
        text: 'Thank you for describing the task, I have noticed you have provided a very large context for your question. The amount of source code is very big in particular. Can we do something about it?',
      },
      {
        type: 'user',
        text: OPTIMIZATION_PROMPT,
      },
    ];

    const request: GenerateContentArgs = [optimizationPrompt, getFunctionDefs(), 'optimizeContext', 0.2, true, options];
    let result = await generateContentFn(...request);
    result = await validateAndRecoverSingleResult(request, result, generateContentFn);

    const optimizedContext = parseOptimizationResult(fullSourceCode, result);
    if (!optimizedContext) {
      putSystemMessage(`Warning: Context optimization failed. We need to abort.`);
      return StepResult.BREAK;
    }

    if (optimizedContext.length === 0) {
      putSystemMessage(
        'Warning: Context optimization failed to produce useful summaries for all batches. Proceeding with current context.',
      );
      return StepResult.CONTINUE;
    }

    putSystemMessage('Context optimization in progress.', Array.from(optimizedContext));

    const [optimizedSourceCode, contentTokenCount, summaryTokenCount] = optimizeSourceCode(
      sourceCode,
      fullSourceCode,
      Array.from(optimizedContext),
    );

    const tokensAfter = estimateTokenCount(JSON.stringify(optimizedSourceCode));
    const percentageReduced = ((tokensBefore - tokensAfter) / tokensBefore) * 100;

    // Clear previous getSourceCode responses
    clearPreviousSourceCodeResponses(prompt);

    prompt.push(
      {
        type: 'assistant',
        // we may want to put text question here
        functionCalls: [
          {
            name: 'requestFilesContent',
            args: {
              filePaths: Object.keys(optimizedSourceCode),
            },
          },
          {
            name: 'getSourceCode',
            args: {
              filePaths: Object.keys(optimizedSourceCode),
            },
          },
        ],
      },
      {
        type: 'user',
        // we may want to put text answer here
        functionResponses: [
          {
            name: 'requestFilesContent',
            content: JSON.stringify({ filePaths: Object.keys(optimizedSourceCode) }),
          },
          {
            name: 'getSourceCode',
            content: JSON.stringify(getSourceCodeTree(optimizedSourceCode)),
          },
        ],
        cache: true,
      },
    );

    putSystemMessage('Context optimization completed successfully.', {
      tokensBefore,
      tokensAfter,
      contentTokenCount,
      summaryTokenCount,
      percentageReduced: percentageReduced.toFixed(2) + '%',
    });
    return StepResult.CONTINUE;
  } catch (error) {
    putSystemMessage('Error: Context optimization failed. This is unexpected.');
    console.error('Context optimization error:', error);
    return StepResult.BREAK;
  }
}

function parseOptimizationResult(fullSourceCode: SourceCodeMap, calls: FunctionCall[]) {
  const optimizeCall = calls.find((call) => call.name === 'optimizeContext');
  if (!optimizeCall || !optimizeCall.args || !optimizeCall.args.optimizedContext) {
    return null;
  }

  let totalTokens = 0;
  const result: [filePath: string, relevance: number][] = [];

  for (const item of (optimizeCall.args.optimizedContext as { filePath: string; relevance: number }[]).sort((a, b) =>
    a.relevance > b.relevance ? -1 : 1,
  )) {
    const { filePath, relevance } = item;
    if (relevance < 0.5) {
      break;
    }

    const content =
      (fullSourceCode[filePath] && 'content' in fullSourceCode[filePath]
        ? fullSourceCode[filePath]?.content
        : undefined) ?? '';
    totalTokens += estimateTokenCount(content);
    result.push([item.filePath, item.relevance]);

    if (totalTokens > MAX_TOTAL_TOKENS && relevance < 0.7) {
      break;
    }
  }

  return result;
}

function optimizeSourceCode(
  sourceCode: SourceCodeMap,
  fullSourceCode: SourceCodeMap,
  optimizedContext: [filePath: string, relevance: number][],
): [optimizedSourceCode: SourceCodeMap, contentTokenCount: number, summaryTokenCount: number] {
  const optimizedSourceCode: SourceCodeMap = {};
  let contentTokenCount = 0;
  let summaryTokenCount = 0;

  for (const [path] of Object.entries(fullSourceCode)) {
    const isContext = optimizedContext.filter((item) => item[0] === path).length > 0;
    const summary = getSummary(path);
    const content =
      (fullSourceCode[path] && 'content' in fullSourceCode[path] ? fullSourceCode[path]?.content : undefined) ?? null;
    if (isContext && content && !(sourceCode[path] && 'content' in sourceCode[path])) {
      contentTokenCount += estimateTokenCount(content);
      optimizedSourceCode[path] = {
        content,
      };
    } else {
      summaryTokenCount += estimateTokenCount(summary?.summary ?? '');
    }
  }

  return [optimizedSourceCode, contentTokenCount, summaryTokenCount];
}

/**
 * Helper function to clear content from previous getSourceCode responses while preserving the conversation structure
 */
function clearPreviousSourceCodeResponses(prompt: PromptItem[]) {
  for (const item of prompt) {
    if (item.type === 'user' && item.functionResponses) {
      for (const response of item.functionResponses) {
        if (response.name === 'getSourceCode' && response.content) {
          // Zero out the contents but keep the structure
          const sourceCode = parseSourceCodeTree(JSON.parse(response.content));
          for (const path in sourceCode) {
            if ('content' in sourceCode[path]) {
              delete sourceCode[path];
            }
          }
          response.content = JSON.stringify(getSourceCodeTree(sourceCode));
        }
      }
    }
  }
}

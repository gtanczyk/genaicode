import { GenerateContentFunction, PromptItem, FunctionCall } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getSourceCode, SourceCodeMap } from '../../files/read-files.js';
import { functionDefs } from '../function-calling.js';
import { StepResult } from './steps-types.js';
import { estimateTokenCount } from '../token-estimator.js';
import { getSummary } from './step-summarization.js';

const OPTIMIZATION_PROMPT = `You're correct, we need to optimize the context for code generation. Please perform the following tasks and respond by calling the \`optimizeContext\` function with the appropriate arguments:

1. **Summarization**:
   - For **each source code file provided**, generate a **one-sentence summary** of its content.
   - **Do not** infer or include any files not listed.
   - **Do not** include files from previous batches or any other sources.
   - **Use only the content provided**; do not infer or assume additional information.
   - The summary should accurately reflect the main purpose or functionality of the file.

2. **Relevance Rating**:
   - Rate the **relevance** of each file to the user's prompt on a scale from **0 to 1**, using the following guidelines:
     - **0.0 – 0.3 (Not Relevant)**: The file has no apparent connection to the user's prompt.
     - **0.3 – 0.7 (Somewhat Relevant)**: The file has minor or indirect relevance to the prompt.
     - **0.7 – 0.9 (Moderately Relevant)**: The file is related and could contribute to addressing the prompt.
     - **0.9 – 1.0 (Highly Relevant)**: The file is directly related and is important for addressing the prompt.
   - **Evaluation Criteria**:
     - **Keyword Matching**: Does the file contain keywords or topics mentioned in the user's prompt?
     - **Functional Alignment**: Does the file implement features or functionalities requested by the user?
     - **Dependency**: Is the file a dependency of other relevant modules?

3. **Function Call Response**:
   - Respond by **calling the \`optimizeContext\` function**.
   - The function should have the following parameters:
     - \`"userPrompt"\`: The user's original prompt.
     - \`"optimizedContext"\`: An array of absolute paths of files, which are considered as relevant to the user prompt.

**Important Guidelines**:

- **Only include files that are mentioned in \`getSourceCode\` function responses**. **Do not add any other files**.
- **Do not infer or guess additional files**.
- **Do not assign a relevance score of 1 to all files**; evaluate each file individually based on the criteria above.
- **Do not include** any information not present in the file content.
- **Avoid assumptions or hallucinations**; stick strictly to the provided data.
- Ensure the **function call is properly formatted** and **valid**.
- **Provide the response in valid JSON format**.
- **Do not include any extra text** outside of the function call.
- **Ensure the JSON is properly formatted** and **does not contain strings representing JSON** (i.e., do not stringify the JSON, do not wrap strings into quotes).

**Example of valid Function Call**:

\`\`\`json
{
  "function": "optimizeContext",
  "arguments": {
    "userPrompt": "Please review the helper modules.",
    "optimizedContext": [
      "/home/src/utils/helpers.js",
      "/home/src/utils/math.js"
    ]
  }
}
\`\`\``;

const BATCH_SIZE = 200;

export async function executeStepContextOptimization(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  sourceCode: SourceCodeMap,
  options: CodegenOptions,
): Promise<StepResult> {
  const sourceCodeEntries = Object.entries(sourceCode);
  const fullSourceCode = getSourceCode({ forceAll: true }, options);
  const sourceCodeResponse = getSourceCodeResponse(prompt);
  if (!sourceCodeResponse) {
    console.warn('Could not find source code response, something is wrong, but lets continue anyway.');
    return StepResult.CONTINUE;
  }

  try {
    putSystemMessage('Context optimization is starting');

    const totalFiles = sourceCodeEntries.length;
    const batchCount = Math.ceil(totalFiles / BATCH_SIZE);
    const optimizedContext = new Set<string>();

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      const start = batchIndex * BATCH_SIZE;
      const end = Math.min((batchIndex + 1) * BATCH_SIZE, totalFiles);
      const batchSourceCode = Object.fromEntries(sourceCodeEntries.slice(start, end));

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

      const result = await generateContentFn(optimizationPrompt, functionDefs, 'optimizeContext', 0.2, true, options);

      const batchOptimized = parseOptimizationResult(result);

      if (!batchOptimized) {
        putSystemMessage(
          `Warning: Context optimization failed to produce useful summaries for batch ${batchIndex + 1}. Proceeding with full context.`,
        );
        return StepResult.CONTINUE;
      }

      batchOptimized.forEach((path) => optimizedContext.add(path));
    }

    if (optimizedContext.size === 0) {
      putSystemMessage(
        'Warning: Context optimization failed to produce useful summaries for all batches. Proceeding with full context.',
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
    putSystemMessage('Error: Context optimization failed. Proceeding with full context.');
    console.error('Context optimization error:', error);
    return StepResult.CONTINUE;
  }
}

function parseOptimizationResult(result: FunctionCall[]): string[] | null {
  const explanationCall = result.find((call) => call.name === 'optimizeContext');
  if (!explanationCall || !explanationCall.args || !explanationCall.args.optimizedContext) {
    return null;
  }

  try {
    return explanationCall.args.optimizedContext as string[];
  } catch (error) {
    console.error('Failed to parse optimization result:', error);
    return null;
  }
}

function optimizeSourceCode(
  sourceCode: SourceCodeMap,
  fullSourceCode: SourceCodeMap,
  optimizedContext: string[],
): SourceCodeMap {
  const optimizedSourceCode: SourceCodeMap = {};

  for (const [path] of Object.entries(sourceCode)) {
    const isContext = optimizedContext.includes(path);
    if (isContext) {
      optimizedSourceCode[path] = {
        content: ('content' in fullSourceCode[path] ? fullSourceCode[path]?.content : undefined) ?? null,
      };
    } else {
      const summary = getSummary(path);
      optimizedSourceCode[path] = summary
        ? { summary }
        : {
            content: null,
          };
    }
    // if (relevanceInfo?.summary) {
    //   optimizedSourceCode[path].summary = relevanceInfo.summary;
    // }
  }

  return optimizedSourceCode;
}

function getSourceCodeResponse(prompt: PromptItem[]) {
  const getSourceCodeResponse = prompt.find(
    (item) => item.type === 'user' && item.functionResponses?.some((resp) => resp.name === 'getSourceCode'),
  );

  if (getSourceCodeResponse && getSourceCodeResponse.functionResponses) {
    const sourceCodeResponseIndex = getSourceCodeResponse.functionResponses.findIndex(
      (resp) => resp.name === 'getSourceCode',
    );
    if (sourceCodeResponseIndex !== -1) {
      return getSourceCodeResponse.functionResponses[sourceCodeResponseIndex];
    }
  }

  return null;
}

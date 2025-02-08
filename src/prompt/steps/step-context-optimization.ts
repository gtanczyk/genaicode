import { GenerateContentFunction } from '../../ai-service/common-types.js';
import { GenerateContentArgs } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { getSourceCode } from '../../files/read-files.js';
import { SourceCodeMap } from '../../files/source-code-types.js';
import { FileContent } from '../../files/source-code-types.js';
import { getFunctionDefs } from '../function-calling.js';
import { StepResult } from './steps-types.js';
import { estimateTokenCount } from '../token-estimator.js';
import { getSourceCodeResponse } from './steps-utils.js';
import { importantContext } from '../../main/config.js';
import { getSummary } from '../../files/summary-cache.js';
import { md5 } from '../../files/cache-file.js';

export const OPTIMIZATION_PROMPT = `You need to analyze the provided source code files and determine their relevance to the user's prompt. You will then call the \`optimizeContext\` function with the results.

**Crucially, only include files in the \`optimizedContext\` array of the \`optimizeContext\` function call if their calculated relevance score is 0.5 or greater.**

Here are the detailed steps:

1. **Relevance Assessment (Scores from 0.0 to 1.0):**
   - Evaluate the relevance of each file to the user's prompt based on the following scale:
     - 0.0 – 0.3: Not Relevant
     - 0.3 – 0.7: Somewhat Relevant
     - 0.7 – 0.9: Moderately Relevant
     - 0.9 – 1.0: Highly Relevant
   - Consider:
     - Directly implements the core logic required to address the prompt's features.
     - Role in dependency chains of relevant files.
     - Keyword matches with the prompt.
     - Importance as a dependency.

2. **Dependency Consideration:**
   - Understand how files depend on each other.
   - Prioritize files that are directly relevant or are dependencies of highly relevant files.
   - When evaluating a file, consider its position within dependency chains, but **do not include a file in the \`optimizedContext\` if its individual relevance score is below 0.5, even if it's part of a dependency chain of a relevant file.**

3. **Token Awareness:**
   - Be mindful of token usage, but **relevance (specifically a score of 0.5 or higher) is the primary criterion for inclusion in \`optimizedContext\`.**

4. **Function Call - \`optimizeContext\`:**
   - Call the \`optimizeContext\` function with the following arguments:
     - \`"userPrompt"\`: The original user prompt.
     - \`"reasoning"\`: A detailed, step-by-step explanation of the thought process used to determine the optimized context.
     - \`"optimizedContext"\`: **An array containing ONLY files with a relevance score of 0.5 or higher.** Each object in the array should have:
       - \`"reasoning"\`:  Specific reasoning for why *this particular file* is relevant and has a score of 0.5 or higher.
       - \`"filePath"\`: Absolute file path.
       - \`"relevance"\`: The calculated relevance score (0.5 to 1.0).

**Important Guidelines:**

- **Strict Filtering:** **Only files with a relevance score of 0.5 or more should be included in the \`optimizedContext\` array.**
- **No Guessing:** Only use files provided in the \`getSourceCode\` response.
- **Evaluate Individually and in Chains:** Consider both individual relevance and dependencies, but the 0.5 threshold is paramount for inclusion.
- **Proper JSON:** Ensure the \`optimizeContext\` call is valid JSON.
- **Full Paths:** Use absolute file paths.
- **Focus on 0.5+:** The \`optimizedContext\` array should be exclusively populated with files meeting the relevance criteria.
- **Handling Codebase-Wide Operations:**
    - If the user prompt indicates a codebase-wide operation, choose one of the following \`optimizeContext\` strategies:
        - **Empty Context:** For operations applying to all files simultaneously, call \`optimizeContext\` with an empty \`optimizedContext\` and explain in the \`reasoning\`.
        - **Main Entry Points:** For operations starting with key files, identify main entry points and call \`optimizeContext\` with these files (relevance=1.0), explaining in the \`reasoning\`.
- **Data Flow Consideration**: Consider the entire lifecycle of the data involved in the user's request, from the user interface to the database and back. Include files involved in handling, storing, and transmitting this data.
- **Intent and Contribution Analysis:**  For each file, evaluate its purpose and how it contributes to fulfilling the user's prompt. Consider the flow of logic and data. Which files are essential for the requested outcome, not just tangentially related?
- **Functional Web Analysis:**  Think of the codebase as a web of interconnected functionalities. Identify the key functional areas involved in the user's prompt and trace the connections between files within these areas.
- **Core Responsibility Assessment:**  Identify the files that are primarily responsible for managing the lifecycle, data, or logic of the entities involved in the \`userPrompt\`. These files are likely to be highly relevant.
- **Data Flow Mapping:**  Trace the flow of data related to the user's request. Identify the files involved in creating, storing, transforming, and retrieving this data.

Now, analyze the source code and call the \`optimizeContext\` function accordingly.`;

export const OPTIMIZATION_TRIGGER_PROMPT =
  'Thank you for describing the task, I have noticed you have provided a very large context for your question. The amount of source code is very big in particular. Can we do something about it?';

export const CONTEXT_OPTIMIZATION_TEMPERATURE = 0.2;

const MAX_TOTAL_TOKENS = 10000;

export async function executeStepContextOptimization(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  options: CodegenOptions,
): Promise<StepResult> {
  const fullSourceCode = getSourceCode({ forceAll: true }, options);
  const tokensBefore = estimateTokenCount(JSON.stringify(fullSourceCode));

  const sourceCodeResponse = getSourceCodeResponse(prompt);
  if (!sourceCodeResponse || !sourceCodeResponse.content) {
    putSystemMessage('Could not find source code response, something is wrong, but lets continue anyway.');
    return StepResult.CONTINUE;
  }

  if (tokensBefore < MAX_TOTAL_TOKENS) {
    putSystemMessage('Context optimization is not needed, because the code base is small.');
    sourceCodeResponse.content = JSON.stringify(fullSourceCode);
    return StepResult.CONTINUE;
  }

  const sourceCode = JSON.parse(sourceCodeResponse.content);

  try {
    putSystemMessage('Context optimization is starting for large codebase');

    const optimizationPrompt: PromptItem[] = [
      ...prompt,
      {
        type: 'assistant',
        text: OPTIMIZATION_TRIGGER_PROMPT,
      },
      {
        type: 'user',
        text: OPTIMIZATION_PROMPT,
      },
    ];

    const request: GenerateContentArgs = [
      optimizationPrompt,
      getFunctionDefs(),
      'optimizeContext',
      CONTEXT_OPTIMIZATION_TEMPERATURE,
      ModelType.CHEAP,
      options,
    ];
    const result = await generateContentFn(...request);

    const [optimizedContext, irrelevantFiles] = parseOptimizationResult(fullSourceCode, result);
    if (!optimizedContext) {
      putSystemMessage(`Warning: Context optimization failed. We need to abort.`);
      return StepResult.BREAK;
    }

    if (optimizedContext.length === 0) {
      putSystemMessage('Context optimization did not generate changes to current context.');
      return StepResult.CONTINUE;
    }

    const [optimizedSourceCode, contentTokenCount, summaryTokenCount] = optimizeSourceCode(
      sourceCode,
      fullSourceCode,
      Array.from(optimizedContext),
      irrelevantFiles,
    );

    const tokensAfter = estimateTokenCount(JSON.stringify(optimizedSourceCode));
    const percentageReduced = ((tokensBefore - tokensAfter) / tokensBefore) * 100;

    // Clear previous getSourceCode responses
    clearPreviousSourceCodeResponses(prompt, irrelevantFiles);

    prompt.push(
      {
        type: 'assistant',
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
        functionResponses: [
          {
            name: 'requestFilesContent',
            content: JSON.stringify({ filePaths: Object.keys(optimizedSourceCode) }),
          },
          {
            name: 'getSourceCode',
            content: JSON.stringify(optimizedSourceCode),
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
      optimizedContext,
    });
    return StepResult.CONTINUE;
  } catch (error) {
    putSystemMessage('Error: Context optimization failed. This is unexpected.');
    return StepResult.BREAK;
  }
}

function parseOptimizationResult(
  fullSourceCode: SourceCodeMap,
  calls: FunctionCall[],
): [[string, number][], Set<string>] {
  const optimizeCall = calls.find((call) => call.name === 'optimizeContext');
  if (!optimizeCall || !optimizeCall.args || !optimizeCall.args.optimizedContext) {
    return [[], new Set()];
  }

  let totalTokens = 0;
  const result: [filePath: string, relevance: number][] = [];
  const relevantFiles = new Set<string>();
  const irrelevantFiles = new Set<string>();

  // First pass: collect initially relevant files and track irrelevant ones
  for (const item of optimizeCall.args.optimizedContext as { filePath: string; relevance: number }[]) {
    if (item.relevance >= 0.5) {
      relevantFiles.add(item.filePath);
    } else {
      irrelevantFiles.add(item.filePath);
    }
  }

  // Add files which are in full source and are not in the optimized context
  for (const filePath in fullSourceCode) {
    if (!relevantFiles.has(filePath) && !irrelevantFiles.has(filePath)) {
      irrelevantFiles.add(filePath);
    }
  }

  // Second pass: calculate final relevance including dependency weights
  for (const item of (optimizeCall.args.optimizedContext as { filePath: string; relevance: number }[]).sort((a, b) =>
    a.relevance > b.relevance ? -1 : 1,
  )) {
    const { filePath, relevance } = item;
    if (relevance < 0.5) {
      break;
    }
    if (importantContext.files?.includes(filePath)) {
      // Preserving important files
      continue;
    }

    // Calculate dependency weight (0-0.3) and add to base relevance
    const depWeight = calculateDependencyWeight(filePath, fullSourceCode, relevantFiles);
    const finalRelevance = Math.min(1, relevance + depWeight);

    const content =
      (fullSourceCode[filePath] && 'content' in fullSourceCode[filePath]
        ? fullSourceCode[filePath]?.content
        : undefined) ?? '';

    // Get all dependencies for token counting
    const allDeps = getAllDependencies(filePath, fullSourceCode);
    const depsContent = Array.from(allDeps)
      .map(
        (dep) =>
          (fullSourceCode[dep] && 'content' in fullSourceCode[dep] ? fullSourceCode[dep]?.content : undefined) ?? '',
      )
      .join('');

    totalTokens += estimateTokenCount(content + depsContent);
    result.push([item.filePath, finalRelevance]);

    // Break if we exceed token limit and the file isn't highly relevant
    if (totalTokens > MAX_TOTAL_TOKENS && finalRelevance < 0.7) {
      break;
    }
  }

  return [result, irrelevantFiles];
}

function optimizeSourceCode(
  sourceCode: SourceCodeMap,
  fullSourceCode: SourceCodeMap,
  optimizedContext: [filePath: string, relevance: number][],
  irrelevantFiles: Set<string>,
): [optimizedSourceCode: SourceCodeMap, contentTokenCount: number, summaryTokenCount: number] {
  const optimizedSourceCode: SourceCodeMap = {};
  let contentTokenCount = 0;
  let summaryTokenCount = 0;

  // Create a set of all required files (including dependencies)
  const requiredFiles = new Set<string>();
  for (const [path] of optimizedContext) {
    requiredFiles.add(path);
    // Add all dependencies
    const deps = getAllDependencies(path, fullSourceCode);
    deps.forEach((dep) => requiredFiles.add(dep));
  }

  for (const [path] of Object.entries(fullSourceCode)) {
    const isRequired = requiredFiles.has(path);
    const isIrrelevant = irrelevantFiles.has(path);
    const summary = getSummary(path);
    const content =
      (fullSourceCode[path] && 'content' in fullSourceCode[path] ? fullSourceCode[path]?.content : undefined) ?? null;
    const dependencies =
      fullSourceCode[path] && 'dependencies' in fullSourceCode[path] ? fullSourceCode[path]?.dependencies : undefined;

    if (
      isRequired &&
      content &&
      !(sourceCode[path] && 'content' in sourceCode[path] && sourceCode[path].content !== null)
    ) {
      contentTokenCount += estimateTokenCount(content);
      optimizedSourceCode[path] = {
        fileId: md5(path),
        content,
        ...(dependencies && !isIrrelevant && { dependencies }),
      };
    } else if (summary && !isIrrelevant) {
      summaryTokenCount += estimateTokenCount(summary.summary);
      optimizedSourceCode[path] = {
        fileId: md5(path),
        ...summary,
        ...(dependencies && { dependencies }),
      };
    }
  }

  return [optimizedSourceCode, contentTokenCount, summaryTokenCount];
}

/**
 * Helper function to clear content from previous getSourceCode responses while preserving the conversation structure
 */
function clearPreviousSourceCodeResponses(prompt: PromptItem[], irrelevantFiles: Set<string>) {
  for (const item of prompt) {
    if (item.type === 'user' && item.functionResponses) {
      for (const response of item.functionResponses) {
        if (response.name === 'getSourceCode' && response.content) {
          // Zero out the contents but keep the structure
          const sourceCode = JSON.parse(response.content);
          for (const path in sourceCode) {
            if (importantContext.files?.includes(path)) {
              continue; // Preserve important files
            }
            if ('content' in sourceCode[path]) {
              sourceCode[path].content = null;
            } else {
              // Zero out content for irrelevant files
              const file = sourceCode[path] as FileContent;
              file.content = null;
            }

            if (irrelevantFiles.has(path) && sourceCode[path]) {
              // Remove summary and dependencies for irrelevant files
              if ('summary' in sourceCode[path]) {
                delete sourceCode[path].summary;
              }
              delete sourceCode[path].dependencies;
            }
          }
          response.content = JSON.stringify(sourceCode);
        }
      }
    }
  }
}

/**
 * Calculate dependency chain weight for a file
 * Returns a value between 0 and 0.3 based on dependency importance
 */
function calculateDependencyWeight(
  filePath: string,
  sourceCode: SourceCodeMap,
  relevantFiles: Set<string>,
  visited = new Set<string>(),
): number {
  if (visited.has(filePath)) {
    return 0; // Prevent circular dependency loops
  }
  visited.add(filePath);

  const fileData = sourceCode[filePath];
  if (!fileData || !('dependencies' in fileData) || !fileData.dependencies) {
    return 0;
  }

  let weight = 0;
  for (const dep of fileData.dependencies) {
    if (dep.type === 'local' && relevantFiles.has(dep.path)) {
      // Direct dependency of a relevant file gets higher weight
      weight = Math.max(weight, 0.2);
      // Recursively check dependencies with diminishing weight
      const depWeight = calculateDependencyWeight(dep.path, sourceCode, relevantFiles, visited) * 0.7;
      weight = Math.max(weight, depWeight);
    }
  }

  return weight;
}

/**
 * Get all dependencies for a file, including transitive ones
 */
function getAllDependencies(filePath: string, sourceCode: SourceCodeMap, visited = new Set<string>()): Set<string> {
  if (visited.has(filePath)) {
    return new Set(); // Prevent circular dependency loops
  }
  visited.add(filePath);

  const deps = new Set<string>();
  const fileData = sourceCode[filePath];
  if (!fileData || !('dependencies' in fileData) || !fileData.dependencies) {
    return deps;
  }

  for (const dep of fileData.dependencies) {
    if (dep.type === 'local') {
      deps.add(dep.path);
      // Add transitive dependencies
      const transitiveDeps = getAllDependencies(dep.path, sourceCode, visited);
      transitiveDeps.forEach((d) => deps.add(d));
    }
  }

  return deps;
}

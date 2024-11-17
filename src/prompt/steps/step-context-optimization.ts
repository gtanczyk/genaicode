import { GenerateContentFunction, PromptItem, FunctionCall, GenerateContentArgs } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { FileContent, getSourceCode, SourceCodeMap } from '../../files/read-files.js';
import { getFunctionDefs } from '../function-calling.js';
import { StepResult } from './steps-types.js';
import { estimateTokenCount } from '../token-estimator.js';
import { getSummary } from './step-summarization.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { getSourceCodeResponse } from './steps-utils.js';
import { getSourceCodeTree, parseSourceCodeTree, SourceCodeTree } from '../../files/source-code-tree.js';

const OPTIMIZATION_PROMPT = `You're correct, we need to optimize the context for code generation. Please perform the following tasks and respond by calling the \`optimizeContext\` function with the appropriate arguments:

1. **Relevance and Dependency Analysis**:
   - Rate the **relevance** of each file to the user's prompt on a scale from **0 to 1**, using the following guidelines:
     - **0.0 – 0.3 (Not Relevant)**: The file has no apparent connection to the user's prompt.
     - **0.3 – 0.7 (Somewhat Relevant)**: The file has minor or indirect relevance to the prompt.
     - **0.7 – 0.9 (Moderately Relevant)**: The file is related and could contribute to addressing the prompt.
     - **0.9 – 1.0 (Highly Relevant)**: The file is directly related and is important for addressing the prompt.
   
   - **Evaluation Criteria**:
     - **Direct Relevance**: Does the file directly implement features mentioned in the prompt?
     - **Dependency Chain**: Is the file part of a dependency chain of relevant files?
     - **Keyword Matching**: Does the file contain keywords or topics from the prompt?
     - **Dependency Importance**: Is the file a critical dependency for other relevant files?

2. **Dependency-Aware Optimization**:
   - Consider both direct and indirect dependencies
   - Prioritize files that are:
     - Directly relevant to the prompt
     - Dependencies of highly relevant files
     - Part of important dependency chains
   - Handle dependency chains intelligently:
     - Include critical dependencies even if they seem less relevant
     - Consider the full dependency tree when evaluating relevance
     - Avoid breaking dependency chains of important files

3. **Token-Aware Optimization**:
   - Balance relevance against token usage
   - Consider the combined token cost of dependency chains
   - Prioritize files where the relevance justifies the token usage
   - Consider the token cost of including entire dependency chains

4. **Function Call Response**:
   - Call the \`optimizeContext\` function with:
     - \`"userPrompt"\`: The original prompt
     - \`"optimizedContext"\`: Array of objects containing:
       - \`"filePath"\`: Absolute file path
       - \`"relevance"\`: Calculated relevance score (0 to 1)

**Important Guidelines**:
- **Only include files from \`getSourceCode\` response**
- **Do not guess or infer additional files**
- **Evaluate each file individually and as part of dependency chains**
- **Consider both direct and indirect dependencies**
- **Ensure proper JSON formatting**
- **Include full file paths**
- **Filter out low-relevance files (< 0.5)**
- **Maintain dependency chain integrity**

Now could you please analyze the source code and return me the optimized context?
`;

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

    const [optimizedContext, irrelevantFiles] = parseOptimizationResult(fullSourceCode, result);
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

    if (isRequired && content && !(sourceCode[path] && 'content' in sourceCode[path])) {
      contentTokenCount += estimateTokenCount(content);
      optimizedSourceCode[path] = {
        content,
        ...(dependencies && !isIrrelevant && { dependencies }),
      };
    } else if (summary && !isIrrelevant) {
      summaryTokenCount += estimateTokenCount(summary.summary);
      optimizedSourceCode[path] = {
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
          const sourceCode = parseSourceCodeTree(JSON.parse(response.content));
          for (const path in sourceCode) {
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
          response.content = JSON.stringify(getSourceCodeTree(sourceCode));
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

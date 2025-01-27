import { GenerateContentFunction } from '../../ai-service/common-types.js';
import { GenerateContentArgs } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { SourceCodeMap } from '../../files/source-code-types.js';
import { DependencyInfo } from '../../files/source-code-types.js';
import { getFunctionDefs } from '../function-calling.js';
import { md5, writeCache } from '../../files/cache-file.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { estimateTokenCount } from '../token-estimator.js';
import { validateAndRecoverSingleResult } from './step-validate-recover.js';
import { refreshFiles } from '../../files/find-files.js';
import { summaryCache, SummaryInfo, CACHE_VERSION } from '../../files/summary-cache.js';

const BATCH_SIZE = 50;
const MAX_SUMMARY_TOKENS = 10;

const SUMMARIZATION_PROMPT = `Your role is to summarize content of files in ${MAX_SUMMARY_TOKENS} tokens or fewer while also detecting dependencies. 

For the summary:
- Fit as much information as possible given the limit
- The summary must be understandable for LLM, does not need to be human readable
- Include as much key information as possible, even if readability and style are sacrificed
- Do not include information if they can be already derived from the file name or file path
- Focus on the main purpose or functionality
- The length of summary should be max ${MAX_SUMMARY_TOKENS} tokens

For dependencies:
- Identify all import and require statements in the code
- Detect both local (relative) and external (package) dependencies
- For local dependencies, include the full resolved path
- For external dependencies, include the package name
- Mark dependencies as either 'local' or 'external'
- Include the original import path as provided in the code

Provide your response using the \`setSummaries\` function with the following structure:
{
  "filePath": "absolute/path/to/file",
  "summary": "concise summary",
  "dependencies": [
    {
      "path": "resolved/path/or/package",
      "type": "local|external",
    }
  ]
}

The file path must be absolute, exactly the same as you receive in the \`getSourceCode\` function responses.
`;

export function getSummarizationPrefix(
  items: { path: string; content: string | null }[],
  allFilePaths: string[],
): PromptItem[] {
  return [
    { type: 'systemPrompt', systemPrompt: SUMMARIZATION_PROMPT },
    { type: 'user', text: 'Hello, I would like to ask you to summarize my codebase' },
    {
      type: 'assistant',
      text: 'Sure, I can help with that. Please first provide me with a list of files in the codebase.',
      functionCalls: [
        {
          name: 'getSourceCode',
        },
      ],
    },
    {
      type: 'user',
      text: 'Ok, this is the list of files in the codebase',
      functionResponses: [
        {
          name: 'getSourceCode',
          content: JSON.stringify(Object.fromEntries(allFilePaths.map((path) => [path, { content: null }]))),
        },
      ],
      cache: true,
    },
    {
      type: 'assistant',
      text: "Thank you for providing the list of files. Now I'm ready to summarize the content of files once you provide them.",
    },
    {
      type: 'user',
      text: 'please summarize the following files:\n' + items.map((item) => `\n- ${item.path}`).join(''),
    },
    {
      type: 'assistant',
      text: 'Please provide me with the content of the files so that I can summarize them.',
      functionCalls: [
        {
          name: 'getSourceCode',
          args: {
            filePaths: items.map((item) => item.path),
          },
        },
      ],
    },
    {
      type: 'user',
      text: 'Here is the content of the files:',
      functionResponses: [
        {
          name: 'getSourceCode',
          content: JSON.stringify(Object.fromEntries(items.map((item) => [item.path, { content: item.content }]))),
        },
      ],
    },
  ];
}

export async function summarizeSourceCode(
  generateContentFn: GenerateContentFunction,
  sourceCode: SourceCodeMap,
  options: CodegenOptions,
): Promise<void> {
  const items = Object.entries(sourceCode).map(([path, file]) => ({
    path,
    content: 'content' in file ? file.content : null,
    dependencies: 'dependencies' in file ? file.dependencies : undefined,
  }));

  await summarizeBatch(generateContentFn, items, sourceCode, options);

  refreshFiles();
}

async function summarizeBatch(
  generateContentFn: GenerateContentFunction,
  items: { path: string; content: string | null; dependencies?: DependencyInfo[] }[],
  allSourceCodeMap: SourceCodeMap,
  options: CodegenOptions,
): Promise<void> {
  const uncachedItems = items.filter(
    (item) =>
      summaryCache._version !== CACHE_VERSION ||
      !summaryCache[item.path] ||
      summaryCache[item.path].checksum !== md5(item.content ?? ''),
  );

  if (uncachedItems.length === 0) {
    putSystemMessage('Summarization of the source code was skipped.');
    return;
  }

  putSystemMessage('Summarization of the source code is starting.', { files: uncachedItems.map((item) => item.path) });

  for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
    const batch = uncachedItems.slice(i, i + BATCH_SIZE);

    const prompt: PromptItem[] = getSummarizationPrefix(batch, Object.keys(allSourceCodeMap));
    const request: GenerateContentArgs = [prompt, getFunctionDefs(), 'setSummaries', 0.2, ModelType.CHEAP, options];
    let result = await generateContentFn(...request);
    result = await validateAndRecoverSingleResult(request, result, generateContentFn);

    const batchSummaries = parseSummarizationResult(result);
    batchSummaries.forEach((file) => {
      const item = items.find((item) => item.path === file.filePath);
      const content = item?.content ?? '';
      summaryCache[file.filePath] = {
        tokenCount: estimateTokenCount(content),
        summary: file.summary,
        checksum: md5(content),
        dependencies: (file.dependencies ?? item?.dependencies ?? []).map((dep) => ({
          path: dep.projectFilePath ?? dep.path,
          type: dep.type,
        })),
      };
    });
  }

  summaryCache._version = CACHE_VERSION;

  writeCache('summaries', summaryCache);

  putSystemMessage('Summarization of the source code is finished.');
}

function parseSummarizationResult(result: FunctionCall[]): (SummaryInfo & { dependencies?: DependencyInfo[] })[] {
  if (!Array.isArray(result) || result.length === 0 || !result[0].args || !Array.isArray(result[0].args.summaries)) {
    throw new Error('Invalid summarization result');
  }
  return result[0].args.summaries;
}

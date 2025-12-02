import { GenerateContentFunction, GenerateContentArgs } from '../../ai-service/common-types.js';
import { PromptItem } from '../../ai-service/common-types.js';
import { FunctionCall } from '../../ai-service/common-types.js';
import { ModelType } from '../../ai-service/common-types.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { FileId, DependencyInfo, SourceCodeMap } from '../../files/source-code-types.js';
import { getFunctionDefs } from '../function-calling.js';
import { md5, writeCache } from '../../files/cache-file.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { estimateTokenCount } from '../token-estimator.js';
import { refreshFiles } from '../../files/find-files.js';
import { summaryCache, SummaryInfo, CACHE_VERSION, popularDependencies } from '../../files/summary-cache.js';
import { generateFileId } from '../../files/file-id-utils.js';
import { computePopularDependencies } from '../../files/source-code-utils.js';
import { rcConfig } from '../../main/config.js';

const BATCH_SIZE = 25;
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
- Detect both local (file) and external (package) dependencies
- For local dependencies, include the full resolved path
- For external dependencies, include the package name
- Classify dependencies as either 'local' or 'external'
- Provide your response using the \`setSummaries\` function.
- The file path must be absolute, exactly the same as you receive in the \`getSourceCode\` function responses.
- Deduplicate dependencies if they are repeated in the code
- Add only direct dependencies, do not include transitive dependencies.
`;

export function getSummarizationPrefix(
  items: { path: string; content: string | null; fileId: FileId }[],
  allFilePaths: string[],
): PromptItem[] {
  return [
    { type: 'systemPrompt', systemPrompt: SUMMARIZATION_PROMPT },
    { type: 'user', text: 'Hello, I want you to summarize the content of files, and detect dependencies.' },
    {
      type: 'assistant',
      text: "Sure, I can help with that. Please first provide me with a list of files in the codebase. I don't need their contents, just the file paths.",
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
          content: JSON.stringify(
            Object.fromEntries(allFilePaths.map((path) => [path, { fileId: generateFileId(path) }])),
          ),
        },
      ],
      cache: true,
    },
    {
      type: 'assistant',
      text: "Thank you for providing the list of files. Now I'm ready to analyze the content of files once you provide them.",
    },
    {
      type: 'user',
      text: 'Please summarize the following files:\n' + items.map((item) => `\n- ${item.path}`).join(''),
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
          content: JSON.stringify(
            Object.fromEntries(
              items.map((item) => [item.path, { fileId: generateFileId(item.path), content: item.content }]),
            ),
          ),
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
    localDeps: 'localDeps' in file ? file.localDeps : undefined,
    externalDeps: 'externalDeps' in file ? file.externalDeps : undefined,
    fileId: file.fileId,
  }));

  await summarizeBatch(generateContentFn, items, sourceCode, options);

  // Compute and store popular dependencies
  const computedPopularDeps =
    rcConfig.popularDependencies?.enabled !== false
      ? computePopularDependencies(sourceCode, summaryCache, rcConfig.popularDependencies?.threshold ?? 25)
      : new Set<string>();
  popularDependencies.clear();
  computedPopularDeps.forEach((dep) => popularDependencies.add(dep));

  if (popularDependencies.size > 0) {
    putSystemMessage(`Identified ${popularDependencies.size} popular dependencies.`, {
      popularDependencies: Array.from(popularDependencies),
    });
  }

  refreshFiles();
}

async function summarizeBatch(
  generateContentFn: GenerateContentFunction,
  items: { path: string; content: string | null; localDeps?: number[]; externalDeps?: string[]; fileId: FileId }[],
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

  const batches = [];
  for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
    const batch = uncachedItems.slice(i, i + BATCH_SIZE);
    batches.push(batch);
  }

  await Promise.allSettled(
    batches.map(async (batch) => {
      const prompt: PromptItem[] = getSummarizationPrefix(batch, Object.keys(allSourceCodeMap));
      const request: GenerateContentArgs = [
        prompt,
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'setSummaries',
          temperature: 0.2,
          modelType: ModelType.CHEAP,
          expectedResponseType: { text: false, functionCall: true, media: false },
        },
        options,
      ];
      const result = (await generateContentFn(...request))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall);

      const batchSummaries = parseSummarizationResult(result);
      batchSummaries.forEach((file) => {
        const item = items.find((item) => item.path === file.filePath);
        const content = item?.content ?? '';
        const localDeps = file.dependencies?.filter((dep) => dep.type === 'local').map((dep) => dep.fileId!);
        const externalDeps = file.dependencies?.filter((dep) => dep.type === 'external').map((dep) => dep.path);
        summaryCache[file.filePath] = {
          tokenCount: estimateTokenCount(content),
          summary: file.summary,
          checksum: md5(content),
          ...(localDeps && { localDeps: [...new Set(localDeps)] }),
          ...(externalDeps && { externalDeps: [...new Set(externalDeps)] }),
        };
      });

      summaryCache._version = CACHE_VERSION;
      writeCache('summaries', summaryCache);
    }),
  );

  putSystemMessage('Summarization of the source code is finished.');
}

function parseSummarizationResult(result: FunctionCall[]): (SummaryInfo & { dependencies?: DependencyInfo[] })[] {
  if (!Array.isArray(result) || result.length === 0 || !result[0].args || !Array.isArray(result[0].args.summaries)) {
    throw new Error('Invalid summarization result');
  }
  return result[0].args.summaries;
}

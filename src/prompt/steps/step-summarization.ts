import { GenerateContentFunction, PromptItem, FunctionCall } from '../../ai-service/common.js';
import { CodegenOptions } from '../../main/codegen-types.js';
import { SourceCodeMap } from '../../files/read-files.js';
import { functionDefs } from '../function-calling.js';
import { SummaryInfo, SummaryCache } from './steps-types.js';
import { md5, readCache, writeCache } from '../../files/cache-file.js';
import { putSystemMessage } from '../../main/common/content-bus.js';
import { estimateTokenCount } from '../token-estimator.js';

const BATCH_SIZE = 50;
const MAX_SUMMARY_TOKENS = 15;
const CACHE_VERSION = 'v2';

const SUMMARIZATION_PROMPT = `Your role is to summarize content of files in ${MAX_SUMMARY_TOKENS} tokens or fewer. 
Focus on the main purpose or functionality. 
Provide your response using the \`setSummaries\` function.
The length of summary should be max ${MAX_SUMMARY_TOKENS} tokens.
The file path must be absolute, exactly the same as you receive in the \`getSourceCode\` function responses.
`;

const summaryCache: SummaryCache = readCache('summaries', {});

export async function summarizeSourceCode(
  generateContentFn: GenerateContentFunction,
  sourceCode: SourceCodeMap,
  options: CodegenOptions,
): Promise<void> {
  const items = Object.entries(sourceCode).map(([path, file]) => ({
    path,
    content: 'content' in file ? file.content : null,
  }));

  await summarizeBatch(generateContentFn, items, options);
}

async function summarizeBatch(
  generateContentFn: GenerateContentFunction,
  items: { path: string; content: string | null }[],
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

    const summarizationPrompt: PromptItem[] = [
      { type: 'systemPrompt', systemPrompt: SUMMARIZATION_PROMPT },
      { type: 'user', text: 'Hello, I would like to ask you to summarize my codebase' },
      {
        type: 'assistant',
        text: 'Sure, could you please provide the source code? Once you provide it, I will be able to perform the analysis, and provide you with the summaries using `setSummaries` function call.',
        functionCalls: [{ name: 'getSourceCode', id: 'get_source_code' }],
      },
      {
        type: 'user',
        text: 'Ok, this is the source code, and now please summarize the source code.',
        functionResponses: [{ name: 'getSourceCode', call_id: 'get_source_code', content: JSON.stringify(batch) }],
      },
    ];

    const result = await generateContentFn(summarizationPrompt, functionDefs, 'setSummaries', 0.2, true, options);
    const batchSummaries = parseSummarizationResult(result);

    batchSummaries.forEach((file) => {
      const content = items.find((item) => item.path === file.path)?.content ?? '';
      summaryCache[file.path] = {
        tokenCount: estimateTokenCount(content),
        summary: file.summary,
        checksum: md5(content),
      };
    });
  }

  summaryCache._version = CACHE_VERSION;

  writeCache('summaries', summaryCache);

  putSystemMessage('Summarization of the source code is finished.');
}

function parseSummarizationResult(result: FunctionCall[]): SummaryInfo[] {
  if (!Array.isArray(result) || result.length === 0 || !result[0].args || !Array.isArray(result[0].args.summaries)) {
    throw new Error('Invalid summarization result');
  }
  return result[0].args.summaries;
}

export function getSummary(filePath: string) {
  const summary = summaryCache[filePath];
  return summary ? { summary: summary.summary, tokenCount: summary.tokenCount } : undefined;
}

import { CacheChecksum, readCache } from './cache-file.js';
import { FileId } from './source-code-types.js';

export const CACHE_VERSION = 'v98'; // Incremented version for dependency improvements

export interface SummaryInfo {
  filePath: string;
  tokenCount: number;
  summary: string;
}

export const popularDependencies = new Set<string>();

export type SummaryCache = Record<
  string,
  {
    tokenCount: number;
    summary: string;
    checksum: CacheChecksum;
    localDeps?: FileId[];
    externalDeps?: string[];
  }
> & { _version: string };

export const summaryCache: SummaryCache = readCache<SummaryCache>('summaries', {
  _version: CACHE_VERSION,
} as SummaryCache);

export function getSummary(filePath: string) {
  const summary = summaryCache[filePath];
  return summary
    ? {
        summary: summary.summary,
        ...(summary.localDeps && { localDeps: summary.localDeps }),
        ...(summary.externalDeps && { externalDeps: summary.externalDeps }),
      }
    : undefined;
}

export function clearSummaryCache(filePaths: string[]) {
  for (const filePath of filePaths) {
    delete summaryCache[filePath];
  }
  popularDependencies.clear();
}

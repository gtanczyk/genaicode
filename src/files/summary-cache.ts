import { readCache } from './cache-file.js';
import { DependencyInfo } from './source-code-types';

export const CACHE_VERSION = 'v6'; // Incremented version for dependency support

export interface SummaryInfo {
  filePath: string;
  tokenCount: number;
  summary: string;
}

export type SummaryCache = Record<
  string,
  {
    tokenCount: number;
    summary: string;
    checksum: string;
    dependencies: DependencyInfo[];
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
        ...(summary.dependencies && { dependencies: summary.dependencies }),
      }
    : undefined;
}

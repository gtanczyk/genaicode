import { CacheChecksum, readCache } from './cache-file.js';
import { DependencyInfo } from './source-code-types';

export const CACHE_VERSION = 'v92'; // Incremented version for dependency improvements

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
    dependencies: DependencyInfo[];
  }
> & { _version: string };

export const summaryCache: SummaryCache = readCache<SummaryCache>('summaries', {
  _version: CACHE_VERSION,
} as SummaryCache);

export function getSummary(filePath: string) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    console.warn('Invalid file path provided to getSummary:', filePath);
    return undefined;
  }

  try {
    const summary = summaryCache[filePath];
    return summary
      ? {
          summary: summary.summary,
          ...(summary.dependencies && { dependencies: summary.dependencies }),
        }
      : undefined;
  } catch (error) {
    console.warn(`Error retrieving summary for ${filePath}:`, error);
    return undefined;
  }
}

export function clearSummaryCache(filePaths: string[]) {
  if (!Array.isArray(filePaths)) {
    console.warn('clearSummaryCache expects an array of file paths, got:', typeof filePaths);
    return;
  }

  for (const filePath of filePaths) {
    if (typeof filePath === 'string' && filePath.trim()) {
      delete summaryCache[filePath];
    } else {
      console.warn('Skipping invalid file path in clearSummaryCache:', filePath);
    }
  }
  popularDependencies.clear();
}

import { writeCache, readCache } from '../../files/cache-file.js';
import { AiServiceType } from '../codegen-types.js';

export function collectCost(
  cost: number,
  inputTokens: number,
  outputTokens: number,
  aiService: AiServiceType,
  cheap: boolean = false,
) {
  addUsageTuple({
    timestamp: Date.now(),
    cost,
    inputTokens,
    outputTokens,
    aiService,
    cheap,
  });
}

// New types and interfaces for usage data
interface UsageTuple {
  timestamp: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  aiService: AiServiceType;
  cheap: boolean;
}

interface UsageData {
  tuples: UsageTuple[];
  lastCleanup: number;
}

export interface UsageMetrics {
  cost: number;
  rpm: number;
  rpd: number;
  tpm: number;
  tpd: number;
  ipm: number;
}

const USAGE_CACHE_KEY = 'usageData';
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const DATA_RETENTION_PERIOD = 48 * 60 * 60 * 1000; // 48 hours in milliseconds

// Function to get usage data from cache
function getUsageDataFromCache(): UsageData {
  const defaultData: UsageData = { tuples: [], lastCleanup: Date.now() };
  return readCache<UsageData>(USAGE_CACHE_KEY, defaultData);
}

// Function to save usage data to cache
function saveUsageDataToCache(data: UsageData): void {
  writeCache(USAGE_CACHE_KEY, data);
}

// Function to add a new usage tuple
function addUsageTuple(tuple: UsageTuple): void {
  const data = getUsageDataFromCache();
  data.tuples.push(tuple);
  cleanupOldData(data);
  saveUsageDataToCache(data);
}

// Function to clean up old data
function cleanupOldData(data: UsageData): void {
  const now = Date.now();
  if (now - data.lastCleanup > CLEANUP_INTERVAL) {
    const cutoffTime = now - DATA_RETENTION_PERIOD;
    data.tuples = data.tuples.filter((tuple) => tuple.timestamp >= cutoffTime);
    data.lastCleanup = now;
    console.log(`Cleaned up usage data. Remaining entries: ${data.tuples.length}`);
  }
}

export function getUsageMetrics(): Record<AiServiceType | 'total', UsageMetrics> {
  const data = getUsageDataFromCache();
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const tuples = data.tuples.filter((t) => t.timestamp >= oneDayAgo);

  const result: Partial<Record<AiServiceType | 'total', UsageMetrics>> = {};

  for (const tuple of tuples) {
    if (!result[tuple.aiService]) {
      result[tuple.aiService] = {
        cost: 0,
        rpm: 0,
        rpd: 0,
        tpm: 0,
        tpd: 0,
        ipm: 0,
      };
    }
  }

  for (const aiService of Object.keys(result) as AiServiceType[]) {
    const serviceTuples = tuples.filter((tuple) => tuple.aiService === aiService);
    const requestsLastMinute = serviceTuples.filter((t) => t.timestamp >= oneMinuteAgo).length;
    const requestsLastDay = serviceTuples.filter((t) => t.timestamp >= oneDayAgo).length;
    const tokensLastMinute = serviceTuples
      .filter((t) => t.timestamp >= oneMinuteAgo)
      .reduce((sum, t) => sum + t.inputTokens + t.outputTokens, 0);
    const tokensLastDay = serviceTuples
      .filter((t) => t.timestamp >= oneDayAgo)
      .reduce((sum, t) => sum + t.inputTokens + t.outputTokens, 0);
    const cost = serviceTuples.filter((t) => t.timestamp >= oneDayAgo).reduce((sum, t) => sum + t.cost, 0);

    result[aiService] = {
      cost: cost,
      rpm: requestsLastMinute,
      rpd: requestsLastDay,
      tpm: tokensLastMinute,
      tpd: tokensLastDay,
      ipm: 0, // TODO: Implement image request monitoring
    };
  }

  result['total'] = {
    cost: tuples.filter((t) => t.timestamp >= oneDayAgo).reduce((sum, t) => sum + t.cost, 0),
    rpm: tuples.filter((t) => t.timestamp >= oneMinuteAgo).length,
    rpd: tuples.filter((t) => t.timestamp >= oneDayAgo).length,
    tpm: tuples.filter((t) => t.timestamp >= oneMinuteAgo).reduce((sum, t) => sum + t.inputTokens + t.outputTokens, 0),
    tpd: tuples.filter((t) => t.timestamp >= oneDayAgo).reduce((sum, t) => sum + t.inputTokens + t.outputTokens, 0),
    ipm: 0, // TODO: Implement image request monitoring
  };

  return result as Record<AiServiceType | 'total', UsageMetrics>;
}

import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'path';
import findCacheDir from 'find-cache-dir';
import { rcConfig } from '../main/config.js';

const cacheDirectory = findCacheDir({ name: 'genaicode' }) || os.tmpdir();

export function readCache<T>(key: string, defaultValue: T): T {
  const cache = readCacheFile();
  return (key in cache ? cache[key] : defaultValue) as T;
}

export function writeCache<T>(key: string, value: T): void {
  const cache = readCacheFile();
  cache[key] = value;
  writeCacheFile(cache);
}

function getCacheFileName(): string {
  return md5(rcConfig.rootDir) + '.cache.json';
}

function readCacheFile(): Record<string, unknown> {
  const cacheFileName = path.join(cacheDirectory, getCacheFileName());
  try {
    return JSON.parse(fs.readFileSync(cacheFileName, 'utf-8'));
  } catch {
    return {};
  }
}

function writeCacheFile(content: Record<string, unknown>): void {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(path.join(cacheDirectory, getCacheFileName()), JSON.stringify(content), 'utf-8');
}

export type CacheChecksum = string & { readonly __cacheChecksum: true };

export function md5(content: string): CacheChecksum {
  return crypto.createHash('md5').update(content).digest('hex') as CacheChecksum;
}

const getContainerIdsCacheKey = () => 'containerIds';

export function getCachedContainerIds(): string[] {
  return readCache<string[]>(getContainerIdsCacheKey(), []);
}

export function cacheContainerId(containerId: string): void {
  const ids = getCachedContainerIds();
  if (!ids.includes(containerId)) {
    ids.push(containerId);
    writeCache(getContainerIdsCacheKey(), ids);
  }
}

export function removeCachedContainerId(containerId: string): void {
  let ids = getCachedContainerIds();
  if (ids.includes(containerId)) {
    ids = ids.filter((id) => id !== containerId);
    writeCache(getContainerIdsCacheKey(), ids);
  }
}

export function clearCachedContainerIds(): void {
  writeCache(getContainerIdsCacheKey(), []);
}

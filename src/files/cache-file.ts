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

export function md5(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

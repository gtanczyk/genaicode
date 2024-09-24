import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'path';
import findCacheDir from 'find-cache-dir';
import { rcConfig } from '../main/config';

const cacheDirectory = findCacheDir({ name: 'genaicode' }) || os.tmpdir();

export function readCache<T>(key: string, defaultValue: T) {
  return readCacheFile()[key] || defaultValue;
}

export function writeCache<T>(key: string, value: T) {
  const cache = readCacheFile();
  cache[key] = value;
  writeCacheFile(cache);
}

function getCacheFileName() {
  return md5(rcConfig.rootDir) + '.cache.json';
}

function readCacheFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(cacheDirectory, getCacheFileName()), 'utf-8'));
  } catch {
    return {};
  }
}

function writeCacheFile(content: Record<string, unknown>) {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(path.join(cacheDirectory, getCacheFileName()), JSON.stringify(content), 'utf-8');
}

export function md5(content: string) {
  return crypto.createHash('md5').update(content).digest('hex');
}

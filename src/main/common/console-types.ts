/**
 * @fileoverview
 * This file contains shared type definitions for console logging, used by both the
 * Vite plugin frontend and the CLI console logger. Having a common location for
 * these types prevents circular dependencies and build issues.
 */

/**
 * Log level for console entries.
 */
export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'assert';

/**
 * Represents a single captured console log entry.
 */
export interface ConsoleLogEntry {
  timestamp: number;
  level: ConsoleLogLevel;
  message: string;
  args: unknown[];
}

/**
 * Mode for retrieving console logs.
 */
export type ConsoleLogMode = 'suffix' | 'prefix' | 'summary';

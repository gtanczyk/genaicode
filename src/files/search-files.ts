import fs from 'fs';
import path from 'path';
import globRegex from 'glob-regex';
import { getSourceFiles } from './find-files.js';
import { rcConfig } from '../main/config.js';

/**
 * Represents a match found during the search
 */
export interface SearchMatch {
  /** Path to the file where the match was found */
  filePath: string;
  /** Type of match (filename or content) */
  matchType: 'filename' | 'content';
  /** Line number where the match was found (for content matches) */
  lineNumber?: number;
  /** Context around the match (for content matches) */
  matchContext?: string;
  /** The actual matched text */
  matchedText: string;
}

/**
 * Options for the search operation
 */
export interface SearchOptions {
  /** The search query */
  query: string;
  /** Glob patterns to include files */
  includePatterns?: string[];
  /** Glob patterns to exclude files */
  excludePatterns?: string[];
  /** Whether to search in file contents */
  searchInContent?: boolean;
  /** Whether to search in file names */
  searchInFilenames?: boolean;
  /** Case sensitive search */
  caseSensitive?: boolean;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Number of context lines to include around content matches */
  contextLines?: number;
}

/**
 * Result of the search operation
 */
export interface SearchResult {
  /** Array of matches found */
  matches: SearchMatch[];
  /** Total number of matches found (before maxResults limit) */
  totalMatches: number;
  /** Time taken to perform the search (in milliseconds) */
  searchTime: number;
  /** Number of files searched */
  filesSearched: number;
}

/**
 * Searches source code files based on provided options
 */
export function searchSourceCode(options: SearchOptions): SearchResult {
  const startTime = Date.now();
  const matches: SearchMatch[] = [];
  let totalMatches = 0;
  let filesSearched = 0;

  // Prepare search query
  const searchRegex = new RegExp(
    options.caseSensitive ? options.query : options.query,
    options.caseSensitive ? 'g' : 'gi',
  );

  // Get all source files
  const sourceFiles = getSourceFiles();

  // Filter files based on include/exclude patterns
  const filteredFiles = sourceFiles.filter((file) => {
    const relativePath = path.relative(rcConfig.rootDir, file);

    // Check include patterns
    if (options.includePatterns?.length) {
      if (!options.includePatterns.some((pattern) => globRegex(pattern).test(relativePath))) {
        return false;
      }
    }

    // Check exclude patterns
    if (options.excludePatterns?.length) {
      if (options.excludePatterns.some((pattern) => globRegex(pattern).test(relativePath))) {
        return false;
      }
    }

    return true;
  });

  // Search through filtered files
  for (const file of filteredFiles) {
    filesSearched++;

    // Search in filename if enabled
    if (options.searchInFilenames !== false) {
      const fileName = path.basename(file);
      const matches_ = fileName.match(searchRegex);
      if (matches_) {
        totalMatches += matches_.length;
        matches.push({
          filePath: file,
          matchType: 'filename',
          matchedText: fileName,
        });

        if (options.maxResults && matches.length >= options.maxResults) {
          break;
        }
      }
    }

    // Search in content if enabled
    if (options.searchInContent !== false) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineMatches = line.match(searchRegex);

          if (lineMatches) {
            totalMatches += lineMatches.length;

            // Get context lines
            const contextLines = options.contextLines || 0;
            const startLine = Math.max(0, i - contextLines);
            const endLine = Math.min(lines.length, i + contextLines + 1);
            const context = lines.slice(startLine, endLine).join('\n');

            matches.push({
              filePath: file,
              matchType: 'content',
              lineNumber: i + 1,
              matchContext: context,
              matchedText: line,
            });

            if (options.maxResults && matches.length >= options.maxResults) {
              break;
            }
          }
        }
      } catch (error) {
        console.warn(`Error reading file ${file}:`, error);
      }
    }

    if (options.maxResults && matches.length >= options.maxResults) {
      break;
    }
  }

  return {
    matches: matches.slice(0, options.maxResults),
    totalMatches,
    searchTime: Date.now() - startTime,
    filesSearched,
  };
}

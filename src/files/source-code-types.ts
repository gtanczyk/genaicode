/**
 * Represents a dependency in the source code
 */
export interface DependencyInfo {
  /** Path of the dependeny */
  path: string;
  /** Type of dependency */
  type: 'local' | 'external';
  /** Unique identifier for the dependent file */
  fileId?: string;
}

/**
 * Represents file content with optional dependencies
 */
export interface FileContent {
  /** The actual content of the file */
  content: string | null;
  /** Optional list of dependencies */
  dependencies?: DependencyInfo[];
}

/**
 * Represents a file summary with optional dependencies
 */
export interface FileSummary {
  /** Summary of the file content */
  summary?: string;
  /** Optional list of dependencies */
  dependencies?: DependencyInfo[];
}

/**
 * Represents extracted fragments from a file with optional dependencies
 */
export interface FileFragments extends FileSummary {
  /** The extracted fragment from the file based on a prompt */
  fragments: string[];
}

export type FileId = string & { readonly __fileId: true };

/**
 * Maps file paths to their content, summary, or fragments
 * Each file entry must have a fileId and can contain either:
 * - FileContent: Full content of the file
 * - FileSummary: A summary of the file's content
 * - FileFragments: Extracted fragments from the file based on a prompt
 */
export type SourceCodeMap = Record<string, { fileId: FileId } & (FileContent | FileSummary | FileFragments)>;

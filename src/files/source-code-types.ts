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
} /**
 * Represents a file summary with optional dependencies
 */

export interface FileSummary {
  /** Summary of the file content */
  summary?: string;
  /** Optional list of dependencies */
  dependencies?: DependencyInfo[];
}

export type FileId = string & { readonly __fileId: true };

export type SourceCodeMap = Record<string, { fileId: FileId } & (FileContent | FileSummary)>;

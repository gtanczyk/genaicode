import { AiServiceType } from './service-configurations-types.js';

/**
 * Result of uploading a file to an AI service provider.
 */
export interface FileUploadResult {
  /** Provider-specific file identifier */
  fileId: string;
  /** Original filename */
  filename: string;
  /** File size in bytes */
  size: number;
  /** When the file will expire (if applicable) */
  expiresAt?: Date;
}

/**
 * Result of downloading a file from an AI service provider.
 */
export interface FileDownloadResult {
  /** The filename */
  filename: string;
  /** File content as a Buffer */
  content: Buffer;
  /** MIME type of the file */
  mimeType: string;
}

/**
 * Output file metadata returned from code execution.
 */
export interface CodeExecutionOutputFile {
  /** Provider-specific file identifier */
  fileId: string;
  /** The filename */
  filename: string;
  /** File size in bytes */
  size: number;
  /** MIME type of the file */
  mimeType?: string;
}

/**
 * Interface for AI service provider file operations.
 * Each provider implements this interface differently based on their Files API.
 */
export interface FilesApiProvider {
  /** Upload a file to the AI service */
  uploadFile(filePath: string, purpose?: string): Promise<FileUploadResult>;

  /** Download a file from the AI service */
  downloadFile(fileId: string): Promise<FileDownloadResult>;

  /** Delete a file (cleanup) */
  deleteFile(fileId: string): Promise<void>;
}

/**
 * Registry of Files API provider factories.
 */
const filesApiProviders = new Map<string, () => FilesApiProvider>();

/**
 * Register a Files API provider factory for a given AI service type.
 */
export function registerFilesApiProvider(serviceType: string, factory: () => FilesApiProvider): void {
  filesApiProviders.set(serviceType, factory);
}

/**
 * Get the Files API provider for a given AI service type.
 * Returns undefined if the service type doesn't support file operations.
 */
export function getFilesApiProvider(serviceType: AiServiceType | string | undefined): FilesApiProvider | undefined {
  if (!serviceType) return undefined;
  const factory = filesApiProviders.get(serviceType);
  return factory ? factory() : undefined;
}

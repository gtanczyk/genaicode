import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import OpenAI from 'openai';
import axios from 'axios';
import assert from 'node:assert';
import { getServiceConfig } from './service-configurations.js';

export interface FileUploadResult {
  fileId: string;
  filename: string;
  size: number;
  expiresAt?: Date;
}

export interface FileDownloadResult {
  filename: string;
  content: Buffer;
  mimeType: string;
}

export interface FilesApiProvider {
  /**
   * Upload a file to the AI service
   */
  uploadFile(filePath: string, purpose?: string): Promise<FileUploadResult>;

  /**
   * Download a file from the AI service
   */
  downloadFile(fileId: string): Promise<FileDownloadResult>;

  /**
   * Delete a file (cleanup)
   */
  deleteFile(fileId: string): Promise<void>;

  /**
   * List uploaded files (optional, for debugging)
   */
  listFiles?(): Promise<FileUploadResult[]>;
}

/**
 * OpenAI Files API Implementation
 */
class OpenAIFilesApi implements FilesApiProvider {
  private client: OpenAI;

  constructor() {
    const config = getServiceConfig('openai');
    assert(config?.apiKey, 'OpenAI API key not configured');
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.openaiBaseUrl,
    });
  }

  async uploadFile(filePath: string, purpose: string = 'assistants'): Promise<FileUploadResult> {
    const fileStream = fs.createReadStream(filePath);
    const response = await this.client.files.create({
      file: fileStream,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      purpose: purpose as any,
    });

    return {
      fileId: response.id,
      filename: response.filename,
      size: response.bytes,
      expiresAt: undefined, // OpenAI files don't strictly expire in the same way, or it's not returned here
    };
  }

  async downloadFile(fileId: string): Promise<FileDownloadResult> {
    // OpenAI SDK returns a readable stream or text depending on method
    // files.content returns the content
    const response = await this.client.files.content(fileId);

    // The response is a Response-like object in newer OpenAI SDKs, or we can get arrayBuffer
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Retrieve file metadata to get filename
    const fileInfo = await this.client.files.retrieve(fileId);

    return {
      filename: fileInfo.filename,
      content: buffer,
      mimeType: mime.lookup(fileInfo.filename) || 'application/octet-stream',
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.client.files.delete(fileId);
  }

  async listFiles(): Promise<FileUploadResult[]> {
    const response = await this.client.files.list();
    return response.data.map((f) => ({
      fileId: f.id,
      filename: f.filename,
      size: f.bytes,
    }));
  }
}

/**
 * Anthropic Files API Implementation (Beta)
 */
class AnthropicFilesApi implements FilesApiProvider {
  private apiKey: string;
  private baseUrl = 'https://api.anthropic.com/v1';

  constructor() {
    const config = getServiceConfig('anthropic');
    assert(config?.apiKey, 'Anthropic API key not configured');
    this.apiKey = config.apiKey!;
  }

  async uploadFile(filePath: string, purpose: string = 'batch'): Promise<FileUploadResult> {
    // Note: As of late 2024/2025, Anthropic might have a Files API for prompt caching or batch processing.
    // The 'code_execution' tool usually accepts text/code directly, but for large inputs/outputs,
    // we might need to use their specific API if available.
    // IMPORTANT: Anthropic's current public API for "Files" is primarily for PDF support in messages
    // or Batch API. Code execution usually works with context.
    // However, the prompt implies we should implement this.
    // If the official Files API is for Batch, we might abuse it or use it if supported by code execution.
    // Assuming a standard /v1/files endpoint exists similar to OpenAI for the sake of this abstraction,
    // or utilizing the PDF support mechanism.

    // For now, let's implement a generic upload if the endpoint exists,
    // otherwise this might just mock or use a specific beta endpoint.
    // Documentation reference (hypothetical or based on recent betas):
    // POST /v1/files

    const formData = new FormData();
    const fileContent = fs.readFileSync(filePath);
    const blob = new Blob([fileContent]);
    const filename = path.basename(filePath);

    formData.append('file', blob, filename);
    formData.append('purpose', purpose);

    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-2024-10-22', // Example beta header
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic upload failed: ${response.status} ${text}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    return {
      fileId: data.id,
      filename: data.filename,
      size: data.bytes,
    };
  }

  async downloadFile(_: string): Promise<FileDownloadResult> {
    // Anthropic API might not expose direct download for all file types yet,
    // but assuming symmetry with upload:
    throw new Error('Anthropic file download not fully supported in this version.');
  }

  async deleteFile(_: string): Promise<void> {
    // Implementation for delete
    // await axios.delete(...)
  }
}

/**
 * Gemini (Google AI Studio) Files API Implementation
 */
class GeminiFilesApi implements FilesApiProvider {
  private apiKey: string;
  private uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/files';

  constructor() {
    const config = getServiceConfig('ai-studio');
    assert(config?.apiKey, 'AI Studio API key not configured');
    this.apiKey = config.apiKey!;
  }

  async uploadFile(filePath: string): Promise<FileUploadResult> {
    const filename = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    const numBytes = stats.size;

    // 1. Initial resumable upload request
    const initResponse = await axios.post(
      this.uploadUrl,
      { file: { display_name: filename } },
      {
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': numBytes,
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
      },
    );

    const uploadUrl = initResponse.headers['x-goog-upload-url'];
    assert(uploadUrl, 'Failed to get upload URL from Gemini API');

    // 2. Upload the actual bytes
    const fileContent = fs.readFileSync(filePath);

    const uploadResponse = await axios.post(uploadUrl, fileContent, {
      headers: {
        'Content-Length': numBytes,
        'X-Goog-Upload-Offset': 0,
        'X-Goog-Upload-Command': 'upload, finalize',
        'x-goog-api-key': this.apiKey,
      },
    });

    const fileData = uploadResponse.data.file;

    return {
      fileId: fileData.name, // Format: files/123xyz
      filename: fileData.displayName || filename,
      size: parseInt(fileData.sizeBytes, 10),
      expiresAt: fileData.expirationTime ? new Date(fileData.expirationTime) : undefined,
    };
  }

  async downloadFile(_: string): Promise<FileDownloadResult> {
    // Gemini Files API usually does not allow downloading the original content directly via simple GET
    // for all file types (mostly for processing).
    // However, generated output files from code execution might be different.
    // If this is for code execution output, we might need to handle it differently
    // (e.g. it might be inline base64 in the response, not a file API download).
    // But if we are implementing the interface:
    throw new Error(
      'Gemini file download via Files API is not supported. Output files are usually returned inline or via different mechanism.',
    );
  }

  async deleteFile(fileId: string): Promise<void> {
    // fileId format: files/xxxx
    const url = `${this.baseUrl}/${fileId.replace('files/', '')}`;
    await axios.delete(url, {
      params: { key: this.apiKey },
    });
  }

  async listFiles(): Promise<FileUploadResult[]> {
    const response = await axios.get(this.baseUrl, {
      params: { key: this.apiKey, pageSize: 100 },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.data.files || []).map((f: any) => ({
      fileId: f.name,
      filename: f.displayName,
      size: parseInt(f.sizeBytes, 10),
      expiresAt: f.expirationTime ? new Date(f.expirationTime) : undefined,
    }));
  }
}

/**
 * Factory function to get the appropriate provider
 */
export function getFilesApiProvider(serviceType: string): FilesApiProvider {
  switch (serviceType) {
    case 'openai':
      return new OpenAIFilesApi();
    case 'ai-studio':
    case 'vertex-ai': // Vertex might need different implementation using GoogleAuth, but sharing for now if compatible or fallback
      return new GeminiFilesApi();
    case 'anthropic':
      return new AnthropicFilesApi();
    default:
      throw new Error(`Files API not supported for service: ${serviceType}`);
  }
}

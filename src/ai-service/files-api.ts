import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import OpenAI from 'openai';
import axios from 'axios';
import assert from 'node:assert';
import { getServiceConfig } from './service-configurations.js';
import { AiServiceType } from './service-configurations-types.js';

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

  constructor(serviceType: AiServiceType = 'openai') {
    const config = getServiceConfig(serviceType);
    assert(config?.apiKey, `${serviceType} API key not configured`);
    // Cast to access openaiBaseUrl which is available on openai, local-llm, and plugin service configs
    const baseURL = (config as { openaiBaseUrl?: string }).openaiBaseUrl;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL,
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
      expiresAt: undefined,
    };
  }

  async downloadFile(fileId: string): Promise<FileDownloadResult> {
    const response = await this.client.files.content(fileId);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
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

  private get headers() {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'files-api-2025-04-14',
    };
  }

  async uploadFile(filePath: string, purpose: string = 'batch'): Promise<FileUploadResult> {
    const formData = new FormData();
    const fileContent = fs.readFileSync(filePath);
    // Convert Buffer to Uint8Array to satisfy BlobPart type constraint
    const blob = new Blob([new Uint8Array(fileContent)]);
    const filename = path.basename(filePath);

    formData.append('file', blob, filename);
    formData.append('purpose', purpose);

    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: this.headers,
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

  async downloadFile(fileId: string): Promise<FileDownloadResult> {
    const response = await fetch(`${this.baseUrl}/files/${fileId}/content`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic download failed: ${response.status} ${text}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Try to get filename from Content-Disposition header
    const contentDisposition = response.headers.get('content-disposition') ?? '';
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch ? filenameMatch[1] : fileId;
    const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';

    return { filename, content: buffer, mimeType };
  }

  async deleteFile(fileId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/files/${fileId}`, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic delete failed: ${response.status} ${text}`);
    }
  }

  async listFiles(): Promise<FileUploadResult[]> {
    const response = await fetch(`${this.baseUrl}/files`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic list files failed: ${response.status} ${text}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.data || []).map((f: any) => ({
      fileId: f.id,
      filename: f.filename,
      size: f.bytes,
    }));
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

  async downloadFile(fileId: string): Promise<FileDownloadResult> {
    // Gemini Files API does not support direct binary download of uploaded files.
    // Code execution output files are returned inline in the response as base64.
    // This method is provided for interface compliance but will throw for unsupported cases.
    throw new Error(
      `Gemini file download via Files API is not supported for fileId: ${fileId}. ` +
        'Code execution output files are returned inline in the API response.',
    );
  }

  async deleteFile(fileId: string): Promise<void> {
    // fileId format: files/xxxx — strip prefix if present
    const id = fileId.startsWith('files/') ? fileId.slice('files/'.length) : fileId;
    await axios.delete(`${this.baseUrl}/${id}`, {
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
 * Factory function to get the appropriate Files API provider for the given AI service.
 */
export function getFilesApiProvider(serviceType: string): FilesApiProvider {
  switch (serviceType) {
    case 'openai':
      return new OpenAIFilesApi();
    case 'github-models':
      return new OpenAIFilesApi('github-models');
    case 'ai-studio':
    case 'vertex-ai':
      return new GeminiFilesApi();
    case 'anthropic':
      return new AnthropicFilesApi();
    default:
      // Support plugin services that use OpenAI-compatible APIs
      if (serviceType.startsWith('plugin:')) {
        return new OpenAIFilesApi(serviceType as AiServiceType);
      }
      throw new Error(`Files API not supported for service: ${serviceType}`);
  }
}

# Code Execution with File I/O - Implementation Plan

**Issue**: [GEN-157] Implement `codeExecution` action type with file I/O support
**Created**: 2025-01-31
**Status**: Planning

---

## Executive Summary

This document outlines the implementation plan for enhancing GenAIcode's `codeExecution` action type to support **file input/output** across four major AI providers: **OpenAI**, **Anthropic Claude**, **Google Gemini**, and **xAI Grok**.

The key insight from analyzing provider documentation is that **all services support file I/O during code execution**, but with different mechanisms:

- **OpenAI**: Persistent file IDs with container-based storage
- **Anthropic**: Base64/text in tool results, beta Files API
- **Gemini**: Inline base64 data in responses
- **xAI**: Files API with download endpoints

**Critical Feature**: Large files should **NOT be embedded in the prompt context**. Instead, they should be:

1. Uploaded via the provider's Files API
2. Referenced by ID in the code execution request
3. Downloaded when the AI generates output files
4. Presented to the user for approval before saving to the project

---

## Provider Comparison

| Feature          | **OpenAI**                | **Anthropic**                  | **Gemini**             | **xAI**                        |
| ---------------- | ------------------------- | ------------------------------ | ---------------------- | ------------------------------ |
| **Tool Name**    | `code_interpreter`        | `code_execution_20250825`      | `code_execution`       | `code_execution`               |
| **Input Method** | Files API + `attachments` | Files API + `container_upload` | Files API + `contents` | Files API + message attachment |
| **Max Upload**   | 512 MB                    | 500 MB                         | 2 GB                   | 48 MB                          |
| **Output Type**  | Persistent `file_id`      | Base64/text in result          | Inline base64          | Base64/text in response        |
| **Sandbox Path** | `/mnt/data/`              | Container filesystem           | Working directory      | Python environment             |
| **Retention**    | 20 min (ephemeral)        | Until deleted                  | 48 hours               | 72 hours                       |

---

## Current State Analysis

### What Exists Today

The `codeExecution` action type is partially implemented:

**Working (`src/prompt/steps/step-iterate/handlers/handle-code-execution.ts`)**:

- Basic code execution is registered as an action handler
- Calls `generateContentFn` with `expectedResponseType.codeExecution = true`
- Extracts `executableCode` and `codeExecutionResult` from the AI response
- Returns results as `AssistantItem` with code execution parts

**Working (AI Services)**:

- `ai-studio.ts`: Native Gemini code execution support (tool config, result parsing)
- `openai.ts`: `code_interpreter` tool for OpenAI, `code_execution` for xAI/Grok
- `anthropic.ts`: Beta `code_execution_20250825` tool support

**Working (Types in `common-types.ts`)**:

- `PromptItem.executableCode` (language + code)
- `PromptItem.codeExecutionResult` (outcome + output)
- `GenerateContentResultPart` includes `executableCode` and `codeExecutionResult` variants
- `expectedResponseType.codeExecution` boolean flag

**Working (Frontend)**:

- `MessageContainer` displays code execution results

### What's Missing

- ❌ No file upload capability
- ❌ No file download/save capability
- ❌ Files must be embedded in prompt context (token waste)
- ❌ Large files not supported
- ❌ No Files API abstraction for providers
- ❌ No `outputFiles` in response types
- ❌ No user approval flow for saving output files

---

## Architecture

### Current Flow

```
User Request
    ↓
handleCodeExecution (iterate handler)
    ↓
generateContentFn with expectedResponseType.codeExecution = true
    ↓
AI Service (ai-studio.ts, openai.ts, etc.)
    ↓
Response: { executableCode, codeExecutionResult }
    ↓
Display in MessageContainer (frontend)
```

### Target Flow (File I/O)

```
User Request + Optional File Selection
    ↓
handleCodeExecution
    ↓
[NEW] Upload selected files via provider Files API
    ↓
generateContentFn with:
  - expectedResponseType.codeExecution = true
  - fileIds: [...] (references to uploaded files)
    ↓
AI Service executes code with file access
    ↓
Response: {
  executableCode,
  codeExecutionResult,
  [NEW] outputFiles: [{ fileId, filename, size }]
}
    ↓
[NEW] Download output files from provider
    ↓
[NEW] Prompt user: "Save these files to project?"
    ↓
[NEW] Write approved files to disk
    ↓
Display results in MessageContainer
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Backend)

#### 1.1 Files API Abstraction Layer

**New file**: `src/ai-service/files-api.ts`

Create a provider-agnostic abstraction for file upload/download/delete operations:

```typescript
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

export interface CodeExecutionOutputFile {
  fileId: string;
  filename: string;
  size: number;
  mimeType?: string;
}

export interface FilesApiProvider {
  uploadFile(filePath: string, purpose?: string): Promise<FileUploadResult>;
  downloadFile(fileId: string): Promise<FileDownloadResult>;
  deleteFile(fileId: string): Promise<void>;
}
```

Use a registry pattern so each AI service can register its Files API implementation:

```typescript
export function registerFilesApiProvider(serviceType: AiServiceType, factory: () => FilesApiProvider): void;
export function getFilesApiProvider(serviceType: AiServiceType | undefined): FilesApiProvider | undefined;
```

#### 1.2 Type Updates

**File**: `src/ai-service/common-types.ts`

Add `outputFiles` to `codeExecutionResult` in both `PromptItem` and `GenerateContentResultPart`:

```typescript
codeExecutionResult?: {
  outcome: 'OUTCOME_OK' | 'OUTCOME_FAILED' | 'OUTCOME_DEADLINE_EXCEEDED';
  output: string;
  outputFiles?: Array<{
    fileId: string;
    filename: string;
    size: number;
    mimeType?: string;
  }>;
};
```

Add `fileIds` and `uploadedFiles` to the `config` in `GenerateContentArgs`:

```typescript
config: {
  // ...existing fields...
  fileIds?: string[];
  uploadedFiles?: Array<{
    fileId: string;
    filename: string;
    originalPath: string;
  }>;
};
```

**File**: `src/prompt/steps/step-iterate/step-iterate-types.ts`

Add `filePaths` to `CodeExecutionArgs`:

```typescript
export type CodeExecutionArgs = {
  message: string;
  filePaths?: string[];
};
```

Add `outputFiles` to `AssistantItem.codeExecutionResult`.

#### 1.3 Provider-Specific Implementations

Each AI service needs a `FilesApiProvider` implementation:

| Provider      | Implementation File                     | API Used                                               |
| ------------- | --------------------------------------- | ------------------------------------------------------ |
| **Gemini**    | `src/ai-service/gemini-files-api.ts`    | `client.files.upload()` + inline base64 extraction     |
| **OpenAI**    | `src/ai-service/openai-files-api.ts`    | `/v1/files` + `/v1/containers/{id}/files/{id}/content` |
| **Anthropic** | `src/ai-service/anthropic-files-api.ts` | `/v1/files` (beta header)                              |
| **xAI**       | `src/ai-service/xai-files-api.ts`       | `/v1/files` + `/v1/files:download`                     |

---

### Phase 2: AI Service Integration

#### 2.1 Update AI Service Signatures

**Files to update**:

- `src/ai-service/ai-studio.ts` — accept `fileIds`, include file references in Gemini `contents`
- `src/ai-service/openai.ts` — accept `fileIds`, map to `attachments` with `code_interpreter` tool
- `src/ai-service/anthropic.ts` — accept `fileIds`, include as `container_upload` content blocks
- `src/ai-service/vertex-ai.ts` — same as ai-studio (delegates to shared implementation)

#### 2.2 Parse Output Files from Responses

Each provider returns output files differently:

- **Gemini**: Extract from inline base64 data in response parts
- **OpenAI**: Extract from `message.content[].image_file.file_id` or file annotations
- **Anthropic**: Parse tool result content for new file references
- **xAI**: Parse response for file references in tool call results

---

### Phase 3: Action Handler Enhancement

#### 3.1 Update `handleCodeExecution`

**File**: `src/prompt/steps/step-iterate/handlers/handle-code-execution.ts`

Enhanced flow:

1. Extract `filePaths` from `iterateCall.args`
2. Get `FilesApiProvider` for the active AI service
3. Upload each file, collecting `FileUploadResult[]` with original paths
4. Pass `fileIds` and `uploadedFiles` metadata to `generateContentFn`
5. Extract `outputFiles` from `codeExecutionResult`
6. Log output file info via `putSystemMessage`
7. Best-effort cleanup of uploaded files
8. Return response with `outputFiles` included in `AssistantItem`

Key design decisions:

- **Graceful degradation**: If no `FilesApiProvider` is registered, skip file operations silently
- **Error handling**: Upload failures are logged but don't block code execution
- **Cleanup**: File deletion failures are caught and ignored (best-effort)
- **Index safety**: Track original paths alongside upload results to avoid index misalignment if some uploads fail

#### 3.2 User Approval for Output Files (Future)

A separate enhancement to prompt the user before saving output files to disk:

```
Code execution generated output files:
  - output.csv (2,048 bytes)
  - chart.png (15,360 bytes)

Save to project? [yes/no/select]
```

This requires integration with the existing `askUserForConfirmation` pattern used by other handlers (e.g., `handle-run-container-task.ts`).

---

### Phase 4: Frontend Updates

#### 4.1 Display Output Files

Update the `MessageContainer` component to show output files from code execution results:

- File name, size, and MIME type
- Download button for each file
- Option to save to project directory

#### 4.2 File Selection UI

Add file picker in the chat interface for selecting files to upload for code execution:

- Browse project files
- Multi-select support
- File size warning for large files

---

### Phase 5: Testing

#### 5.1 Unit Tests

- `src/ai-service/files-api.test.ts` — Registry, provider lookup, undefined handling
- `src/prompt/steps/step-iterate/handlers/handle-code-execution.test.ts` — Full handler flow:
  - Basic code execution without files
  - File upload + fileIds passing
  - Upload failure handling
  - Cleanup after execution
  - Output files in response
  - Missing FilesApiProvider graceful degradation

#### 5.2 Integration Tests

- End-to-end flow with mocked AI service
- Provider-specific file upload/download (requires API keys)

---

## Risk Assessment

| Risk                          | Likelihood | Impact | Mitigation                         |
| ----------------------------- | ---------- | ------ | ---------------------------------- |
| Provider API changes          | Medium     | High   | Abstraction layer isolates changes |
| Large file upload failures    | Medium     | Medium | Retry logic, size limits           |
| File retention expiry         | Low        | Medium | Upload just before execution       |
| Cross-provider inconsistency  | High       | Medium | Normalize to common interface      |
| Token cost from file metadata | Low        | Low    | Keep metadata minimal              |

---

## Dependencies

- `@google/genai` — Gemini Files API (`client.files.upload()`)
- `openai` — OpenAI Files API (`/v1/files`)
- `@anthropic-ai/sdk` — Anthropic Files API (beta)
- No new dependencies needed — all providers already have SDK support

---

## Open Questions

1. **File size limits**: Should we enforce our own limits below the provider maximums?
2. **File type restrictions**: Should we restrict to specific MIME types?
3. **Output file storage**: Where should downloaded output files be saved temporarily?
4. **Multi-file output**: How to handle multiple output files efficiently?
5. **File caching**: Should uploaded files be cached across code execution rounds?

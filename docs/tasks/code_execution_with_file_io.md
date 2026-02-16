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

## Architecture Overview

### Current State (GEN-157 Partial Implementation)

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

**Limitations**:

- ✅ Basic code execution works (Gemini native support)
- ❌ No file upload capability
- ❌ No file download/save capability
- ❌ Files must be in prompt context (token waste)
- ❌ Large files not supported

### Target State (File I/O Support)

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

**File**: `src/ai-service/files-api.ts` (NEW)

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

export interface FilesApiProvider {
  // Upload a file to the AI service
  uploadFile(filePath: string, purpose?: string): Promise<FileUploadResult>;

  // Download a file from the AI service
  downloadFile(fileId: string): Promise<FileDownloadResult>;

  // Delete a file (cleanup)
  deleteFile(fileId: string): Promise<void>;

  // List uploaded files (optional, for debugging)
  listFiles?(): Promise<FileUploadResult[]>;
}
```

Implementations:

- `OpenAIFilesApi` → Uses `/v1/files` and `/v1/containers/{id}/files/{id}/content`
- `AnthropicFilesApi` → Uses `/v1/files` (beta header required)
- `GeminiFilesApi` → Uses `client.files.upload()` and inline data extraction
- `XAIFilesApi` → Uses `/v1/files` and `/v1/files:download`

#### 1.2 Enhanced AI Service Signatures

**File**: `src/ai-service/common-types.ts` (UPDATE)

```typescript
export interface GenerateContentConfig {
  // ... existing fields ...

  // NEW: File references for code execution
  fileIds?: string[];

  // NEW: Uploaded file metadata (for context)
  uploadedFiles?: Array<{
    fileId: string;
    filename: string;
    originalPath: string;
  }>;
}

export interface CodeExecutionResultPart {
  type: 'codeExecutionResult';
  outcome: 'OUTCOME_OK' | 'OUTCOME_FAILED' | 'OUTCOME_DEADLINE_EXCEEDED';
  output: string;

  // NEW: Output files generated by code
  outputFiles?: Array<{
    fileId: string;
    filename: string;
    size: number;
    mimeType?: string;
  }>;
}
```

#### 1.3 Update AI Service Implementations

**Files to Update**:

- `src/ai-service/ai-studio.ts`
- `src/ai-service/openai.ts`
- `src/ai-service/anthropic.ts`
- `src/ai-service/github-models.ts` (if supported)

**Changes**:

1. Accept `fileIds` in `GenerateContentConfig`
2. Map `fileIds` to provider-specific attachment format:
   - OpenAI: `attachments: [{ file_id, tools: [{ type: 'code_interpreter' }] }]`
   - Anthropic: `container_upload` content block
   - Gemini: Include file references in `contents`
   - xAI: Attach to message
3. Parse `outputFiles` from response:
   - OpenAI: Extract from `message.content[].image_file.file_id` or annotations
   - Anthropic: Parse tool result for new file IDs
   - Gemini: Extract inline data and generate temp file IDs
   - xAI: Parse response for file references
4. Return `outputFiles` in `CodeExecutionResultPart`

---

### Phase 2: Action Handler Enhancement

#### 2.1 Update `handleCodeExecution`

**File**: `src/prompt/steps/step-iterate/handlers/handle-code-execution.ts` (UPDATE)

```typescript
export async function handleCodeExecution({
  iterateCall,
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  // 1. Prompt user to select files for upload (optional)
  const filesToUpload = await promptForFileSelection(options);

  // 2. Upload files via Files API
  const uploadedFiles: FileUploadResult[] = [];
  if (filesToUpload.length > 0) {
    const filesApi = getFilesApiProvider(options.aiService);
    for (const filePath of filesToUpload) {
      try {
        const result = await filesApi.uploadFile(filePath);
        uploadedFiles.push(result);
        putSystemMessage(`Uploaded file: ${filePath} → ${result.fileId}`);
      } catch (error) {
        putSystemMessage(`Failed to upload ${filePath}: ${error.message}`, { error });
      }
    }
  }

  // 3. Call AI with code execution enabled + file references
  const result = await generateContentFn(
    prompt,
    {
      modelType: ModelType.DEFAULT,
      expectedResponseType: {
        text: true,
        codeExecution: true,
        functionCall: false,
      },
      fileIds: uploadedFiles.map((f) => f.fileId),
      uploadedFiles: uploadedFiles.map((f) => ({
        fileId: f.fileId,
        filename: path.basename(f.filename),
        originalPath: filesToUpload.find((p) => path.basename(p) === f.filename)!,
      })),
    },
    options,
  );

  // 4. Extract executable code and execution results
  const executableCodePart = result.find((p) => p.type === 'executableCode');
  const codeExecutionResultPart = result.find((p) => p.type === 'codeExecutionResult');

  // 5. Handle output files (if any)
  if (codeExecutionResultPart?.outputFiles?.length > 0) {
    await handleOutputFiles(codeExecutionResultPart.outputFiles, options, getFilesApiProvider(options.aiService));
  }

  // 6. Cleanup uploaded files (if ephemeral)
  await cleanupUploadedFiles(uploadedFiles, options.aiService);

  // 7. Build response
  return {
    breakLoop: false,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: result.find((p) => p.type === 'text')?.text ?? '',
          executableCode: executableCodePart
            ? {
                language: executableCodePart.language,
                code: executableCodePart.code,
              }
            : undefined,
          codeExecutionResult: codeExecutionResultPart
            ? {
                outcome: codeExecutionResultPart.outcome,
                output: codeExecutionResultPart.output,
              }
            : undefined,
        },
        user: {
          type: 'user',
          text: '', // Continue loop
        },
      },
    ],
  };
}
```

#### 2.2 File Selection Helper

**File**: `src/prompt/steps/step-iterate/handlers/handle-code-execution.ts` (NEW FUNCTION)

```typescript
async function promptForFileSelection(options: CodegenOptions): Promise<string[]> {
  if (!options.interactive && !options.ui) {
    return []; // Non-interactive mode: no file selection
  }

  const response = await askUserForInput(
    'Select files to upload for code execution (comma-separated paths, or leave empty)',
    '',
    options,
  );

  if (!response.answer) {
    return [];
  }

  const paths = response.answer
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => path.resolve(rcConfig.rootDir, p));

  // Validate paths
  const validPaths: string[] = [];
  for (const filePath of paths) {
    if (!isProjectPath(filePath)) {
      putSystemMessage(`Skipping ${filePath}: outside project root`);
      continue;
    }
    if (!fs.existsSync(filePath)) {
      putSystemMessage(`Skipping ${filePath}: file not found`);
      continue;
    }
    validPaths.push(filePath);
  }

  return validPaths;
}
```

#### 2.3 Output File Handler

**File**: `src/prompt/steps/step-iterate/handlers/handle-code-execution.ts` (NEW FUNCTION)

```typescript
async function handleOutputFiles(
  outputFiles: Array<{ fileId: string; filename: string; size: number }>,
  options: CodegenOptions,
  filesApi: FilesApiProvider,
): Promise<void> {
  putSystemMessage(`Code execution generated ${outputFiles.length} output file(s)`);

  // Download files
  const downloads: Array<{ filename: string; content: Buffer }> = [];
  for (const file of outputFiles) {
    try {
      const downloaded = await filesApi.downloadFile(file.fileId);
      downloads.push(downloaded);
      putSystemMessage(`Downloaded: ${downloaded.filename} (${downloaded.content.length} bytes)`);
    } catch (error) {
      putSystemMessage(`Failed to download ${file.filename}: ${error.message}`, { error });
    }
  }

  if (downloads.length === 0) {
    return;
  }

  // Ask user for confirmation
  const confirmation = await askUserForConfirmation(
    `Save ${downloads.length} generated file(s) to project?\\n` + downloads.map((d) => `  - ${d.filename}`).join('\\n'),
    options,
  );

  if (!confirmation) {
    putSystemMessage('User declined to save generated files.');
    return;
  }

  // Save files to project
  for (const download of downloads) {
    const targetPath = path.join(rcConfig.rootDir, download.filename);

    // Validate target path
    if (!isProjectPath(targetPath)) {
      putSystemMessage(`Skipping ${download.filename}: would write outside project root`);
      continue;
    }

    try {
      fs.writeFileSync(targetPath, download.content);
      putSystemMessage(`Saved: ${targetPath}`);
    } catch (error) {
      putSystemMessage(`Failed to save ${download.filename}: ${error.message}`, { error });
    }
  }
}
```

---

### Phase 3: Frontend Integration

#### 3.1 Update MessageContainer to Display Code Execution

**File**: `src/main/ui/frontend/app/components/chat/message-container.tsx` (UPDATE)

Add rendering for `executableCode` and `codeExecutionResult`:

```tsx
{
  message.executableCode && (
    <CodeExecutionBlock>
      <CodeHeader>Executable Code ({message.executableCode.language})</CodeHeader>
      <CodeBlock>
        <pre>
          <code>{message.executableCode.code}</code>
        </pre>
      </CodeBlock>
    </CodeExecutionBlock>
  );
}

{
  message.codeExecutionResult && (
    <ExecutionResultBlock outcome={message.codeExecutionResult.outcome}>
      <ResultHeader>Execution Result: {message.codeExecutionResult.outcome}</ResultHeader>
      <ResultOutput>
        <pre>{message.codeExecutionResult.output}</pre>
      </ResultOutput>
    </ExecutionResultBlock>
  );
}
```

#### 3.2 Add Styled Components

**File**: `src/main/ui/frontend/app/components/chat/styles/code-execution-styles.ts` (NEW)

```typescript
import styled from 'styled-components';

export const CodeExecutionBlock = styled.div`
  margin: 12px 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  overflow: hidden;
`;

export const CodeHeader = styled.div`
  background-color: ${({ theme }) => theme.colors.codeBg};
  padding: 8px 12px;
  font-weight: 600;
  font-size: 0.9em;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

export const CodeBlock = styled.div`
  background-color: ${({ theme }) => theme.colors.codeBg};
  padding: 12px;
  overflow-x: auto;

  pre {
    margin: 0;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
  }
`;

export const ExecutionResultBlock = styled.div<{ outcome: string }>`
  margin: 12px 0;
  border: 2px solid ${({ outcome, theme }) => (outcome === 'OUTCOME_OK' ? theme.colors.success : theme.colors.error)};
  border-radius: 8px;
  overflow: hidden;
`;

export const ResultHeader = styled.div`
  padding: 8px 12px;
  font-weight: 600;
  font-size: 0.9em;
  background-color: ${({ theme }) => theme.colors.resultHeaderBg};
`;

export const ResultOutput = styled.div`
  padding: 12px;
  background-color: ${({ theme }) => theme.colors.resultBg};
  max-height: 400px;
  overflow-y: auto;

  pre {
    margin: 0;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
`;
```

#### 3.3 Update ChatMessage Type

**File**: `src/main/common/content-bus-types.ts` (UPDATE)

```typescript
export interface ChatMessage {
  // ... existing fields ...

  // NEW: Code execution fields
  executableCode?: {
    language: string;
    code: string;
  };
  codeExecutionResult?: {
    outcome: 'OUTCOME_OK' | 'OUTCOME_FAILED' | 'OUTCOME_DEADLINE_EXCEEDED';
    output: string;
  };
}
```

---

### Phase 4: Testing & Validation

#### 4.1 Unit Tests

**File**: `src/prompt/steps/step-iterate/handlers/handle-code-execution.test.ts` (NEW)

- Test file upload flow
- Test file download flow
- Test user confirmation flow
- Test error handling (upload failures, download failures)
- Test path validation

#### 4.2 Integration Tests

**File**: `e2e-tests/code-execution-file-io.test.ts` (NEW)

- Test end-to-end workflow with each AI service
- Test large file handling (>10MB)
- Test multiple file uploads
- Test output file generation (e.g., CSV → chart PNG)

#### 4.3 Manual Testing Scenarios

1. **CSV Analysis**:

   - Upload `data.csv` (5MB)
   - Ask AI to analyze and generate a histogram
   - Verify PNG download and save prompt

2. **Image Processing**:

   - Upload `input.jpg`
   - Ask AI to apply filters and save as `output.jpg`
   - Verify correct file handling

3. **Multi-File Workflow**:
   - Upload `script.py` + `config.json`
   - Ask AI to run script with config
   - Verify execution and output

---

## Implementation Checklist

### Backend

- [ ] Create `src/ai-service/files-api.ts` with abstraction layer
- [ ] Implement `OpenAIFilesApi`
- [ ] Implement `AnthropicFilesApi`
- [ ] Implement `GeminiFilesApi`
- [ ] Implement `XAIFilesApi`
- [ ] Update `common-types.ts` with file I/O types
- [ ] Update `ai-studio.ts` to handle file uploads/downloads
- [ ] Update `openai.ts` to handle file uploads/downloads
- [ ] Update `anthropic.ts` to handle file uploads/downloads
- [ ] Update `github-models.ts` (if applicable)
- [ ] Enhance `handleCodeExecution` with file I/O logic
- [ ] Add file selection helper
- [ ] Add output file handler
- [ ] Add cleanup logic for ephemeral files

### Frontend

- [ ] Update `MessageContainer` to render code execution blocks
- [ ] Create `code-execution-styles.ts` with styled components
- [ ] Update `content-bus-types.ts` with code execution fields
- [ ] Add syntax highlighting for code blocks (optional)
- [ ] Add download button for execution results (optional)

### Testing

- [ ] Write unit tests for `handleCodeExecution`
- [ ] Write unit tests for Files API providers
- [ ] Write integration tests for each AI service
- [ ] Manual testing with real files
- [ ] Performance testing with large files (>100MB)

### Documentation

- [ ] Update README with code execution examples
- [ ] Document file size limits per provider
- [ ] Document file retention policies
- [ ] Add troubleshooting guide for file I/O errors

---

## Security Considerations

1. **Path Validation**: All file paths must be validated to prevent directory traversal attacks
2. **File Size Limits**: Enforce provider-specific limits before upload
3. **Sandboxing**: Code execution happens in provider sandboxes (no local execution)
4. **User Confirmation**: Always require user approval before:
   - Uploading project files to external services
   - Saving downloaded files to the project
5. **Cleanup**: Delete uploaded files after execution (especially for ephemeral services like OpenAI)
6. **Error Handling**: Graceful degradation if Files API is unavailable

---

## Open Questions

1. **File Selection UI**: Should we add a file picker in the UI, or rely on text input?
2. **Automatic File Detection**: Should the AI be able to request specific files from the project automatically?
3. **Binary Files**: How do we handle binary files (images, PDFs) in the prompt context?
4. **Streaming**: Should we support streaming for large file downloads?
5. **Caching**: Should we cache uploaded file IDs to avoid re-uploading the same file?

---

## References

- [OpenAI Code Interpreter Docs](https://developers.openai.com/api/docs/guides/tools-code-interpreter/)
- [Anthropic Code Execution Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
- [Gemini Code Execution](https://ai.google.dev/gemini-api/docs/code-execution)
- [xAI Code Execution](https://docs.x.ai/developers/tools/code-execution)
- [Anthropic Files API](https://platform.claude.com/docs/en/build-with-claude/files)
- [OpenAI Files API](https://developers.openai.com/api/reference/resources/files/methods/create/)
- [Gemini Files API](https://ai.google.dev/gemini-api/docs/files)
- [xAI Files API](https://docs.x.ai/developers/rest-api-reference/files/upload)

---

**End of Document**

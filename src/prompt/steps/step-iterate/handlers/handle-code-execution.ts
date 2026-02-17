import path from 'path';
import fs from 'fs';
import { registerActionHandler } from '../step-iterate-handlers.js';
import { ActionHandler, ActionHandlerProps, ActionResult } from '../step-iterate-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { askUserForConfirmation, askUserForInput } from '../../../../main/common/user-actions.js';
import { putAssistantMessage, putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFilesApiProvider, FileUploadResult, FilesApiProvider } from '../../../../ai-service/files-api.js';
import { rcConfig } from '../../../../main/config.js';
import { isProjectPath } from '../../../../files/path-utils.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';

const handleCodeExecution: ActionHandler = async ({
  prompt,
  options,
  generateContentFn,
  iterateCall,
}: ActionHandlerProps): Promise<ActionResult> => {
  try {
    // 1. Prompt user to select files for upload (optional)
    const filesToUpload = await promptForFileSelection(options);

    // 2. Upload files via Files API
    const uploadedFiles: FileUploadResult[] = [];
    if (filesToUpload.length > 0) {
      try {
        const filesApi = getFilesApiProvider(options.aiService);
        for (const filePath of filesToUpload) {
          try {
            putSystemMessage(`Uploading file: ${filePath}...`);
            const result = await filesApi.uploadFile(filePath);
            uploadedFiles.push(result);
            putSystemMessage(`Uploaded file: ${path.basename(filePath)} → ${result.fileId}`);
          } catch (error) {
            putSystemMessage(`Failed to upload ${filePath}: ${(error as Error).message}`, { error });
          }
        }
      } catch (error) {
        putSystemMessage(
          `Files API not supported or failed for service ${options.aiService}: ${(error as Error).message}`,
        );
      }
    }

    // 3. Call AI with code execution enabled + file references
    const result = await generateContentFn(
      [
        ...prompt,
        {
          type: 'assistant',
          text: iterateCall.args?.message ?? 'Execute code based on previous context.',
        },
      ],
      {
        modelType: ModelType.DEFAULT, // Use default (usually capable) model
        expectedResponseType: {
          text: true,
          codeExecution: true,
          functionCall: false, // Disable other tools to focus on code exec
        },
        fileIds: uploadedFiles.map((f) => f.fileId),
        uploadedFiles: uploadedFiles.map((f, index) => {
          // Safe lookup for original path
          const originalPath =
            filesToUpload.find((p) => path.basename(p) === f.filename) ||
            (index < filesToUpload.length ? filesToUpload[index] : f.filename);

          return {
            fileId: f.fileId,
            filename: path.basename(f.filename),
            originalPath,
          };
        }),
      },
      options,
    );

    // Parse result into AssistantItem
    // We need to extract text, executableCode, and codeExecutionResult
    const textParts = result
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n');

    const executableCodePart = result.find((p) => p.type === 'executableCode');
    const codeExecutionResultPart = result.find((p) => p.type === 'codeExecutionResult');

    // 4. Handle output files (if any)
    if (
      codeExecutionResultPart &&
      codeExecutionResultPart.type === 'codeExecutionResult' &&
      codeExecutionResultPart.outputFiles &&
      codeExecutionResultPart.outputFiles.length > 0
    ) {
      try {
        const filesApi = getFilesApiProvider(options.aiService);
        await handleOutputFiles(codeExecutionResultPart.outputFiles, options, filesApi);
      } catch (error) {
        putSystemMessage(`Failed to handle output files: ${(error as Error).message}`);
      }
    }

    const executableCode =
      executableCodePart && executableCodePart.type === 'executableCode'
        ? {
            language: executableCodePart.language,
            code: executableCodePart.code,
          }
        : undefined;

    const codeExecutionResult =
      codeExecutionResultPart && codeExecutionResultPart.type === 'codeExecutionResult'
        ? {
            outcome: codeExecutionResultPart.outcome,
            output: codeExecutionResultPart.output,
            outputFiles: codeExecutionResultPart.outputFiles,
          }
        : undefined;

    // Display results via putAssistantMessage
    putAssistantMessage(iterateCall.args?.message ?? '', {
      text: textParts,
      executableCode,
      codeExecutionResult,
    });

    // Collect user response via askUserForInput
    const response = await askUserForInput('Your answer', '', options);

    // 5. Cleanup uploaded files (optional, depending on retention policy, skipping for now to allow re-use in session if we cached IDs)
    // TODO: Implement cleanup if needed.

    return {
      breakLoop: false,
      items: [
        {
          assistant: {
            type: 'assistant',
            text: iterateCall.args?.message ?? textParts,
            executableCode,
            codeExecutionResult,
          },
          user: {
            type: 'user',
            text: response.answer,
            images: response.images,
          },
        },
      ],
    };
  } catch (error) {
    putSystemMessage(`Error during code execution: ${error instanceof Error ? error.message : String(error)}`);
    return { breakLoop: false, items: [] };
  }
};

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
    .map((p) => (path.isAbsolute(p) ? p : path.resolve(rcConfig.rootDir, p)));

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
      putSystemMessage(`Failed to download ${file.filename}: ${(error as Error).message}`, { error });
    }
  }

  if (downloads.length === 0) {
    return;
  }

  // Ask user for confirmation
  const confirmation = await askUserForConfirmation(
    `Save ${downloads.length} generated file(s) to project?\n` + downloads.map((d) => `  - ${d.filename}`).join('\n'),
    true,
    options,
  );

  if (!confirmation.confirmed) {
    putSystemMessage('User declined to save generated files.');
    return;
  }

  // Save files to project
  for (const download of downloads) {
    // If filename is just a name, save to root or maybe a 'output' folder?
    // Let's save to root or relative to CWD if possible, but safely.
    // Default to rootDir/filename
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
      putSystemMessage(`Failed to save ${download.filename}: ${(error as Error).message}`, { error });
    }
  }
}

registerActionHandler('codeExecution', handleCodeExecution);

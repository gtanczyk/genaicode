import { registerActionHandler } from '../step-iterate-handlers.js';
import { ActionHandler, ActionHandlerProps, ActionResult, CodeExecutionArgs } from '../step-iterate-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { getFilesApiProvider, FileUploadResult } from '../../../../ai-service/files-api.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';

const handleCodeExecution: ActionHandler = async ({
  iterateCall,
  prompt,
  options,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> => {
  const args = iterateCall.args as CodeExecutionArgs | undefined;

  // 1. Upload files if specified via the Files API
  const uploadedFiles: FileUploadResult[] = [];
  const filesApi = getFilesApiProvider(options.aiService);

  if (args?.filePaths && args.filePaths.length > 0 && filesApi) {
    for (const filePath of args.filePaths) {
      try {
        const result = await filesApi.uploadFile(filePath);
        uploadedFiles.push(result);
        putSystemMessage(`Uploaded file for code execution: ${filePath} → ${result.fileId}`);
      } catch (error) {
        putSystemMessage(`Failed to upload ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // 2. Call AI with code execution enabled + file references
  const fileIds = uploadedFiles.map((f) => f.fileId);
  const uploadedFilesMeta = uploadedFiles.map((f, idx) => ({
    fileId: f.fileId,
    filename: f.filename,
    originalPath: args?.filePaths?.[idx] ?? f.filename,
  }));

  const result = await generateContentFn(
    prompt,
    {
      modelType: ModelType.DEFAULT,
      expectedResponseType: {
        text: true,
        codeExecution: true,
        functionCall: false,
      },
      ...(fileIds.length > 0 ? { fileIds, uploadedFiles: uploadedFilesMeta } : {}),
    },
    options,
  );

  // 3. Extract executable code and execution results
  const textParts = result
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

  const executableCodePart = result.find((p) => p.type === 'executableCode');
  const codeExecutionResultPart = result.find((p) => p.type === 'codeExecutionResult');

  // 4. Download output files if any were generated
  const outputFiles =
    codeExecutionResultPart?.type === 'codeExecutionResult' ? codeExecutionResultPart.outputFiles : undefined;

  if (outputFiles && outputFiles.length > 0 && filesApi) {
    for (const file of outputFiles) {
      putSystemMessage(`Code execution produced output file: ${file.filename} (${file.size} bytes)`);
    }
  }

  // 5. Cleanup uploaded files
  if (filesApi && uploadedFiles.length > 0) {
    for (const file of uploadedFiles) {
      try {
        await filesApi.deleteFile(file.fileId);
      } catch {
        // Best-effort cleanup, don't fail the action
      }
    }
  }

  // 6. Build response
  return {
    breakLoop: false,
    items: [
      {
        assistant: {
          type: 'assistant',
          text: textParts,
          executableCode:
            executableCodePart && executableCodePart.type === 'executableCode'
              ? {
                  language: executableCodePart.language,
                  code: executableCodePart.code,
                }
              : undefined,
          codeExecutionResult:
            codeExecutionResultPart && codeExecutionResultPart.type === 'codeExecutionResult'
              ? {
                  outcome: codeExecutionResultPart.outcome,
                  output: codeExecutionResultPart.output,
                  outputFiles: codeExecutionResultPart.outputFiles,
                }
              : undefined,
        },
        user: {
          type: 'user',
          text: '',
        },
      },
    ],
  };
};

registerActionHandler('codeExecution', handleCodeExecution);

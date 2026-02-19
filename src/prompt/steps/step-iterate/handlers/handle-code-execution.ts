import { FunctionCall, GenerateContentArgs, ModelType } from '../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { CodeExecutionInferArgs } from '../../../function-defs/code-execution.js';
import { getFilesApiProvider, FileUploadResult } from '../../../../ai-service/files-api.js';
import { registerActionHandler } from '../step-iterate-handlers.js';
import { ActionHandler, ActionHandlerProps, ActionResult } from '../step-iterate-types.js';

const handleCodeExecution: ActionHandler = async ({
  prompt,
  options,
  generateContentFn,
  iterateCall,
}: ActionHandlerProps): Promise<ActionResult> => {
  // Step 1: Infer codeExecution parameters from context
  const inferRequest: GenerateContentArgs = [
    [
      ...prompt,
      {
        type: 'assistant',
        text: iterateCall.args!.message,
      },
      {
        type: 'user',
        text: 'Please infer the files needed, objective, and desired result for code execution',
      },
    ],
    {
      functionDefs: getFunctionDefs(),
      requiredFunctionName: 'codeExecution',
      temperature: 0.7,
      modelType: ModelType.CHEAP,
      expectedResponseType: {
        text: false,
        functionCall: true,
        media: false,
      },
    },
    options,
  ];

  putSystemMessage('Inferring code execution parameters...');

  const inferResponse = await generateContentFn(...inferRequest);
  const codeExecutionCall = (
    inferResponse
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as FunctionCall<CodeExecutionInferArgs>[]
  ).find((call) => call.name === 'codeExecution');

  if (!codeExecutionCall) {
    putSystemMessage('No code execution call received, skipping code execution.');
    prompt.push(
      {
        type: 'assistant',
        text: iterateCall.args!.message,
      },
      {
        type: 'user',
        text: 'Code execution failed: No parameters could be inferred',
      },
    );
    return {
      items: [],
      breakLoop: false,
    };
  }

  const { filePaths, objective, desiredResult } = codeExecutionCall.args!;

  putSystemMessage(`Inferred code execution parameters`, { filePaths, objective, desiredResult });

  // Step 2: Upload files
  const uploadedFiles: FileUploadResult[] = [];
  if (filePaths.length > 0) {
    try {
      const filesApi = getFilesApiProvider(options.aiService);
      for (const filePath of filePaths) {
        try {
          putSystemMessage(`Uploading file: ${filePath}...`);
          const result = await filesApi.uploadFile(filePath);
          uploadedFiles.push(result);
          putSystemMessage(`Uploaded file: ${result.filename} → ${result.fileId}`);
        } catch (error) {
          putSystemMessage(`Failed to upload ${filePath}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      putSystemMessage(
        `Files API not supported or failed for service ${options.aiService}: ${(error as Error).message}`,
      );
    }
  }

  // Step 3: Execute code with inferred parameters
  const executionResponse = await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: iterateCall.args!.message,
      },
      {
        type: 'user',
        text: `Objective: ${objective}\n\nDesired result: ${desiredResult}`,
      },
    ],
    {
      modelType: ModelType.CHEAP,
      expectedResponseType: {
        text: true,
        codeExecution: true,
        functionCall: false,
      },
      fileIds: uploadedFiles.map((f) => f.fileId),
    },
    options,
  );

  // Step 4: Build result summary
  const textParts = executionResponse
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

  const codeExecutionResultPart = executionResponse.find((p) => p.type === 'codeExecutionResult');
  const executionResult =
    codeExecutionResultPart && codeExecutionResultPart.type === 'codeExecutionResult'
      ? {
          outcome: codeExecutionResultPart.outcome,
          output: codeExecutionResultPart.output,
          outputFiles: codeExecutionResultPart.outputFiles,
        }
      : undefined;

  putSystemMessage('Code execution completed', {
    text: textParts,
    executionResult,
  });

  // Step 5: Push function call + response to prompt
  prompt.push(
    {
      type: 'assistant',
      text: iterateCall.args!.message,
      functionCalls: [codeExecutionCall],
    },
    {
      type: 'user',
      functionResponses: [
        {
          name: 'codeExecution',
          call_id: codeExecutionCall.id,
          content: JSON.stringify({ text: textParts, executionResult }),
        },
      ],
    },
  );

  return {
    items: [],
    breakLoop: false,
  };
};

registerActionHandler('codeExecution', handleCodeExecution);

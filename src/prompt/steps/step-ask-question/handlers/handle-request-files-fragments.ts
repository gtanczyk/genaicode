import { GenerateContentFunction } from '../../../../ai-service/common-types.js';
import { PromptItem } from '../../../../ai-service/common-types.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { refreshFiles } from '../../../../files/find-files.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { SourceCodeMap } from '../../../../files/source-code-types.js';
import { getExpandedContextPaths } from '../../../../files/source-code-utils.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { getFunctionDefs } from '../../../function-calling.js';
import { ExtractFileFragmentsArgs } from '../../../function-defs/extract-file-fragments.js';
import {
  ActionHandlerProps,
  ActionResult,
  AskQuestionCall,
  AssistantItem,
  RequestFilesFragmentsArgs,
  UserItem,
} from '../step-ask-question-types.js';
import { isFileContentAlreadyProvided, categorizeLegitimateFiles } from './file-request-utils.js';

export async function handleRequestFilesFragments({
  askQuestionCall,
  options,
  prompt,
  generateContentFn,
}: ActionHandlerProps): Promise<ActionResult> {
  let requestFilesFragmentsCall = await generateRequestFilesFragmentsCall(
    generateContentFn,
    prompt,
    askQuestionCall,
    options,
    ModelType.CHEAP,
  );

  if (!requestFilesFragmentsCall) {
    return {
      breakLoop: true,
      items: [],
    };
  }

  let requestedFiles = getExpandedContextPaths(requestFilesFragmentsCall.args?.filePaths ?? [], options);
  const fragmentPrompt = requestFilesFragmentsCall.args?.fragmentPrompt;
  if (!fragmentPrompt) {
    putSystemMessage('No fragment prompt provided');
    return {
      breakLoop: true,
      items: [],
    };
  }

  // TODO: Some code duplication with handleRequestFilesContent, need to fix it

  putSystemMessage('Requesting files fragments', {
    requestedFiles,
    expandedRequestedFiles: requestedFiles.filter(
      (file) => !requestFilesFragmentsCall?.args?.filePaths?.includes(file),
    ),
    fragmentPrompt,
  });

  // Check which files are already provided in the conversation history
  const alreadyProvidedFiles = requestedFiles.filter((file) => isFileContentAlreadyProvided(file, prompt));

  if (alreadyProvidedFiles.length === requestedFiles.length) {
    putSystemMessage('All requested files are already provided');
    // All requested files are already provided
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
        functionCalls: [requestFilesFragmentsCall],
      },
      {
        type: 'user',
        text: 'The requested file fragments are already provided in the conversation history.',
        functionResponses: [
          {
            name: 'requestFilesFragments',
            call_id: requestFilesFragmentsCall.id,
            content: JSON.stringify({ filePaths: requestedFiles }),
          },
        ],
        cache: true,
      },
    );

    return { breakLoop: false, items: [] };
  }

  // Filter out already provided files
  requestedFiles = requestedFiles.filter((file) => !isFileContentAlreadyProvided(file, prompt));

  // the request may be caused be an appearance of a new file, so lets refresh
  refreshFiles();

  let { legitimateFiles, illegitimateFiles } = categorizeLegitimateFiles(requestedFiles);

  if (illegitimateFiles.length > 0) {
    requestFilesFragmentsCall = await generateRequestFilesFragmentsCall(
      generateContentFn,
      prompt,
      askQuestionCall,
      options,
      // use non cheap mode, as maybe the cheap mode didn't provide correct files
      ModelType.DEFAULT,
    );

    if (!requestFilesFragmentsCall) {
      return {
        breakLoop: true,
        items: [],
      };
    }

    requestedFiles = requestFilesFragmentsCall.args?.filePaths ?? [];
    const categorized = categorizeLegitimateFiles(requestedFiles);
    legitimateFiles = categorized.legitimateFiles;
    illegitimateFiles = categorized.illegitimateFiles;
  }

  // Get the content of legitimate files
  const sourceCodeMap = await getSourceCode(
    { filterPaths: legitimateFiles, forceAll: true, ignoreImportantFiles: true },
    options,
  );

  // Extract fragments from files using LLM
  const fragmentsMap = await extractFragments(sourceCodeMap, fragmentPrompt, generateContentFn, options);

  const sourceCallId = (askQuestionCall.id ?? askQuestionCall.name) + '_source';
  const assistant: AssistantItem = {
    type: 'assistant',
    text: askQuestionCall.args?.message ?? '',
    functionCalls: [
      requestFilesFragmentsCall,
      { name: 'getSourceCode', id: sourceCallId, args: { filePaths: legitimateFiles } },
    ],
  };

  const user: UserItem = {
    type: 'user',
    text:
      (alreadyProvidedFiles.length > 0
        ? `Some files were already provided in the conversation history:
${alreadyProvidedFiles.map((path) => `- ${path}`).join('\n')}

Providing fragments for the remaining files:
${requestedFiles.map((path) => `- ${path}`).join('\n')}`
        : `All requested file fragments have been provided:
${legitimateFiles.map((path) => `- ${path}`).join('\n')}`) +
      (illegitimateFiles.length > 0
        ? `\n\nSome files are not legitimate and their content cannot be provided:
${illegitimateFiles.map((path) => `- ${path}`).join('\n')}`
        : ''),
    data: { legitimateFiles, illegitimateFiles },
    functionResponses: [
      {
        name: 'requestFilesFragments',
        call_id: requestFilesFragmentsCall.id,
        content: JSON.stringify({ filePaths: legitimateFiles }),
      },
      {
        name: 'getSourceCode',
        call_id: sourceCallId,
        content: JSON.stringify(fragmentsMap),
      },
    ],
    cache: true,
  };

  putSystemMessage('Providing files fragments', {
    requestedFiles,
    legitimateFiles,
    illegitimateFiles,
  });

  prompt.push(assistant, user);

  return { breakLoop: false, items: [] };
}

export async function generateRequestFilesFragmentsCall(
  generateContentFn: GenerateContentFunction,
  prompt: PromptItem[],
  askQuestionCall: AskQuestionCall,
  options: CodegenOptions,
  modelType: ModelType,
) {
  const [requestFilesFragmentsCall] = (await generateContentFn(
    [
      ...prompt,
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Yes, you can request the file fragments.',
      },
    ],
    getFunctionDefs(),
    'requestFilesFragments',
    0.7,
    modelType,
    options,
  )) as [FunctionCall<RequestFilesFragmentsArgs> | undefined];

  return requestFilesFragmentsCall;
}

/**
 * Extract fragments from files using LLM with the new function definition
 */
async function extractFragments(
  sourceCodeMap: SourceCodeMap,
  fragmentPrompt: string,
  generateContentFn: GenerateContentFunction,
  options: CodegenOptions,
): Promise<Record<string, { fragments: string[] }>> {
  const fragmentsMap: Record<string, { fragments: string[] }> = {};

  try {
    // First, call extractFileFragments to get the AI's analysis
    const extractFragmentsCalls = (await generateContentFn(
      [
        {
          type: 'systemPrompt',
          systemPrompt:
            'You are tasked with extracting relevant fragments from a file based on a given prompt. Consider the context, identify meaningful sections, and provide clear explanations for your selections.',
        },
        {
          type: 'assistant',
          text: 'What are the files you would like to extract fragments from?',
          functionCalls: [{ name: 'getSourceCode', args: { filePaths: Object.keys(sourceCodeMap) } }],
        },
        {
          type: 'user',
          text: `I would like to extract fragments from the files.
Extraction prompt: ${fragmentPrompt}`,
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(sourceCodeMap),
            },
          ],
        },
      ],
      getFunctionDefs(),
      // TODO: This will probably fail if more than one file is provided, need to fix it
      'extractFileFragments',
      0.2,
      ModelType.CHEAP,
      options,
    )) as [FunctionCall<ExtractFileFragmentsArgs>];

    if (!extractFragmentsCalls.length) {
      putSystemMessage(`Failed to extract fragments.`);
      return fragmentsMap;
    }

    for (const extractFragmentsCall of extractFragmentsCalls) {
      const filePath = extractFragmentsCall.args!.filePath;
      const fragments = extractFragmentsCall.args!.fragments;

      fragmentsMap[filePath] = {
        fragments: fragments.map((fragment) => fragment.content),
      };
    }

    putSystemMessage(`Successfully extracted fragments`);
  } catch (error) {
    putSystemMessage(`Error during fragment extraction`, { error });
  }

  return fragmentsMap;
}

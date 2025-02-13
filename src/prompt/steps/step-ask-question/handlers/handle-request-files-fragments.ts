import { GenerateContentFunction } from '../../../../ai-service/common-types.js';
import { PromptItem } from '../../../../ai-service/common-types.js';
import { FunctionCall } from '../../../../ai-service/common-types.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { getSourceCode } from '../../../../files/read-files.js';
import { SourceCodeMap } from '../../../../files/source-code-types.js';
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
import { processFileRequests, generateFilesContentPrompt } from './file-request-utils.js';

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

  const fragmentPrompt = requestFilesFragmentsCall.args?.fragmentPrompt;
  if (!fragmentPrompt) {
    putSystemMessage('No fragment prompt provided');
    return {
      breakLoop: true,
      items: [],
    };
  }

  // Process file requests using the utility function
  let { requestedFiles, alreadyProvidedFiles, legitimateFiles, illegitimateFiles } = processFileRequests(
    requestFilesFragmentsCall.args?.filePaths ?? [],
    prompt,
    options,
  );

  if (alreadyProvidedFiles.length === requestedFiles.length) {
    putSystemMessage('All requested files are already provided');
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

  // If there are illegitimate files, try again with non-cheap mode
  if (illegitimateFiles.length > 0) {
    requestFilesFragmentsCall = await generateRequestFilesFragmentsCall(
      generateContentFn,
      prompt,
      askQuestionCall,
      options,
      ModelType.DEFAULT,
    );

    if (!requestFilesFragmentsCall) {
      return {
        breakLoop: true,
        items: [],
      };
    }

    const processed = processFileRequests(requestFilesFragmentsCall.args?.filePaths ?? [], prompt, options);
    requestedFiles = processed.requestedFiles;
    alreadyProvidedFiles = processed.alreadyProvidedFiles;
    legitimateFiles = processed.legitimateFiles;
    illegitimateFiles = processed.illegitimateFiles;
  }

  // Get the content of legitimate files
  const sourceCodeMap = await getSourceCode(
    { filterPaths: legitimateFiles, forceAll: true, ignoreImportantFiles: true },
    options,
  );

  // Extract fragments from files using LLM
  const extractedFragments = await extractFragments(sourceCodeMap, fragmentPrompt, generateContentFn, options);

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
    text: generateFilesContentPrompt(
      alreadyProvidedFiles,
      requestedFiles,
      legitimateFiles,
      illegitimateFiles,
      'fragments',
    ),
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
        content: JSON.stringify({
          fragments: extractedFragments.fragments.map((fragment) => fragment.content),
          filePaths: extractedFragments.filePaths,
        }),
      },
    ],
    cache: true,
  };

  putSystemMessage('Providing files fragments', {
    requestedFiles,
    legitimateFiles,
    illegitimateFiles,
    fragmentCount: extractedFragments.fragments.length,
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
 * Extract fragments from files using LLM with multi-file support
 */
async function extractFragments(
  sourceCodeMap: SourceCodeMap,
  fragmentPrompt: string,
  generateContentFn: GenerateContentFunction,
  options: CodegenOptions,
): Promise<ExtractFileFragmentsArgs> {
  const filePaths = Object.keys(sourceCodeMap);

  try {
    // Process all files in a single LLM call
    const [extractFragmentsCall] = (await generateContentFn(
      [
        {
          type: 'systemPrompt',
          systemPrompt:
            'You are tasked with extracting relevant fragments from multiple source code files based on a given prompt. ' +
            'Analyze each file thoroughly, identify meaningful sections that match the prompt criteria, and provide clear ' +
            'explanations for your selections. Each fragment must be attributed to its source file for proper tracking.',
        },
        {
          type: 'assistant',
          text: 'I will analyze the provided files and extract relevant fragments based on your prompt.',
          functionCalls: [{ name: 'getSourceCode', args: { filePaths } }],
        },
        {
          type: 'user',
          text: `Please extract relevant fragments from the provided files.\nExtraction prompt: ${fragmentPrompt}`,
          functionResponses: [
            {
              name: 'getSourceCode',
              content: JSON.stringify(sourceCodeMap),
            },
          ],
        },
      ],
      getFunctionDefs(),
      'extractFileFragments',
      0.2,
      ModelType.CHEAP,
      options,
    )) as [FunctionCall<ExtractFileFragmentsArgs> | undefined];

    if (!extractFragmentsCall?.args) {
      putSystemMessage('Failed to extract fragments');
      return {
        filePaths,
        fragments: [],
        reasoning: 'Fragment extraction failed',
      };
    }

    putSystemMessage(
      `Successfully extracted ${extractFragmentsCall.args.fragments.length} fragments from ${filePaths.length} files`,
    );
    return extractFragmentsCall.args;
  } catch (error) {
    putSystemMessage('Error during fragment extraction', { error });
    return {
      filePaths,
      fragments: [],
      reasoning: `Error during fragment extraction: ${error}`,
    };
  }
}

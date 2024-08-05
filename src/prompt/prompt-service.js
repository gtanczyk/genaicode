import assert from 'node:assert';
import fs from 'fs';
import * as diff from 'diff';
import mime from 'mime-types';

import { getSystemPrompt } from './systemprompt.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { functionDefs } from '../ai-service/function-calling.js';
import { getSourceCode, getImageAssets } from '../files/read-files.js';
import { disableContextOptimization, temperature, vision, imagen } from '../cli/cli-params.js';
import { generateImage } from '../ai-service/dall-e.js';

/** A function that communicates with model using */
export async function promptService(generateContentFn, codegenPrompt = getCodeGenPrompt()) {
  const messages = prepareMessages(codegenPrompt);

  // First stage: generate code generation summary, which should not take a lot of output tokens
  const getSourceCodeRequest = { name: 'getSourceCode' };

  const prompt = [
    { type: 'systemPrompt', systemPrompt: getSystemPrompt() },
    { type: 'user', text: messages.suggestSourceCode },
    { type: 'assistant', text: messages.requestSourceCode, functionCalls: [getSourceCodeRequest] },
  ];

  const getSourceCodeResponse = {
    type: 'user',
    functionResponses: [{ name: 'getSourceCode', content: messages.sourceCode }],
  };
  prompt.push(getSourceCodeResponse);

  if (vision) {
    prompt.slice(-1)[0].text = messages.suggestImageAssets;
    prompt.push(
      ...[
        { type: 'assistant', text: messages.requestImageAssets, functionCalls: [{ name: 'getImageAssets' }] },
        {
          type: 'user',
          functionResponses: [{ name: 'getImageAssets', content: messages.imageAssets }],
        },
      ],
    );
  }

  prompt.slice(-1)[0].text = messages.prompt;

  let baseResult = await generateContentFn(prompt, functionDefs, 'codegenSummary', temperature);

  const codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary');

  if (codegenSummaryRequest) {
    // Second stage: for each file request the actual code updates
    console.log('Received codegen summary, will collect partial updates', codegenSummaryRequest.args);

    // Sometimes the result happens to be a string
    assert(Array.isArray(codegenSummaryRequest.args.files), 'files is not an array');
    assert(Array.isArray(codegenSummaryRequest.args.contextPaths), 'contextPaths is not an array');

    if (codegenSummaryRequest.args.contextPaths.length > 0 && !disableContextOptimization) {
      console.log('Optimize with context paths.');
      // Monkey patch the initial getSourceCode, do not send parts of source code that are consider irrelevant
      getSourceCodeRequest.args = {
        filePaths: [
          ...codegenSummaryRequest.args.files.map((file) => file.path),
          ...codegenSummaryRequest.args.contextPaths,
        ],
      };
      getSourceCodeResponse.functionResponses.find((item) => item.name === 'getSourceCode').content =
        messages.contextSourceCode(getSourceCodeRequest.args.filePaths);
    }

    // Store the first stage response entirely in conversation history
    prompt.push({ type: 'assistant', functionCalls: baseResult });
    prompt.push({
      type: 'user',
      functionResponses: baseResult.map((call) => ({ name: call.name, call_id: call.id })),
    });

    const result = [];

    for (const file of codegenSummaryRequest.args.files) {
      console.log('Collecting partial update for: ' + file.path + ' using tool: ' + file.updateToolName);
      console.log('- Prompt:', file.prompt);
      console.log('- Temperature', file.temperature);
      if (vision) {
        console.log('- Context image assets', file.contextImageAssets);
      }

      // this is needed, otherwise we will get an error
      if (prompt.slice(-1)[0].type === 'user') {
        prompt.slice(-1)[0].text = file.prompt ?? messages.partialPromptTemplate(file.path);
      } else {
        prompt.push({ type: 'user', text: file.prompt ?? messages.partialPromptTemplate(file.path) });
      }

      if (vision) {
        prompt.slice(-1)[0].images = file.contextImageAssets.map((path) => ({
          path,
          base64url: fs.readFileSync(path, 'base64'),
          mediaType: mime.lookup(path),
        }));
      }

      let partialResult = await generateContentFn(
        prompt,
        functionDefs,
        file.updateToolName,
        file.temperature ?? temperature,
      );

      let getSourceCodeCall = partialResult.find((call) => call.name === 'getSourceCode');
      assert(!getSourceCodeCall, 'Unexpected getSourceCode: ' + JSON.stringify(getSourceCodeCall));

      // Handle image generation requests
      const generateImageCall = partialResult.find((call) => call.name === 'generateImage');
      if (generateImageCall) {
        assert(imagen, 'Image generation requested, but --imagen option not provided');

        console.log('Processing image generation request:', generateImageCall.args);
        try {
          const { prompt: imagePrompt, filePath, size } = generateImageCall.args;
          const generatedImageUrl = await generateImage(imagePrompt, size);

          // Add a createFile call to the result to ensure the generated image is tracked
          partialResult.push({
            name: 'downloadFile',
            args: {
              filePath: filePath,
              downloadUrl: generatedImageUrl,
              explanation: `Downloading generated image`,
            },
          });
        } catch (error) {
          console.error('Error generating image:', error);
          // Add an explanation about the failed image generation
          partialResult.push({
            name: 'explanation',
            args: {
              text: `Failed to generate image: ${error.message}`,
            },
          });
        }
      }

      // Verify if patchFile is one of the functions called, and test if patch is valid and can be applied successfully
      const patchFileCall = partialResult.find((call) => call.name === 'patchFile');
      if (patchFileCall) {
        const { filePath, patch } = patchFileCall.args;
        console.log('Verification of patch for file:', filePath);

        let updatedContent;
        const currentContent = fs.readFileSync(filePath, 'utf-8');

        try {
          updatedContent = diff.applyPatch(currentContent, patch);
        } catch (e) {
          console.log('Error when applying patch', e);
        }

        if (!updatedContent) {
          console.log(`Patch could not be applied for ${filePath}. Retrying without patchFile function.`);

          // Rerun content generation without patchFile function
          partialResult = await generateContentFn(prompt, functionDefs, 'updateFile', temperature);

          let getSourceCodeCall = partialResult.find((call) => call.name === 'getSourceCode');
          assert(!getSourceCodeCall, 'Unexpected getSourceCode: ' + JSON.stringify(getSourceCodeCall));
          assert(!partialResult.find((call) => call.name === 'patchFile'), 'Unexpected patchFile in retry response');
        } else {
          console.log('Patch verified successfully');
        }
      }

      // add the code gen result to the context, as the subsequent code gen may depend on the result
      prompt.push(
        { type: 'assistant', functionCalls: partialResult },
        {
          type: 'user',
          functionResponses: partialResult.map((call) => ({ name: call.name, call_id: call.id })),
        },
      );

      result.push(...partialResult);
    }

    return result;
  } else {
    // This is unexpected, if happens probably means no code updates.
    console.log('Did not receive codegen summary, returning result.');
    return baseResult;
  }
}

/**
 * Function to prepare messages for AI services
 */
function prepareMessages(prompt) {
  return {
    suggestSourceCode: 'I should provide you with application source code.',
    requestSourceCode: 'Please provide application source code.',
    suggestImageAssets: 'I should also provide you with a summary of application image assets',
    requestImageAssets: 'Please provide summary of application image assets.',
    prompt: prompt + '\n Start from generating codegen summary, this summary will be used to generate updates.',
    sourceCode: JSON.stringify(getSourceCode()),
    contextSourceCode: (paths) => JSON.stringify(getSourceCode(paths)),
    imageAssets: JSON.stringify(getImageAssets()),
    partialPromptTemplate(path) {
      return `Thank you for providing the summary, now suggest changes for the \`${path}\` file using appropriate tools.`;
    },
  };
}

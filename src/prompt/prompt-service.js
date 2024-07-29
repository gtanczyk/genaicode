import { getSystemPrompt } from './systemprompt.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { functionDefs } from '../ai-service/function-calling.js';
import { getSourceCode } from '../files/read-files.js';
import { disableContextOptimization } from '../cli/cli-params.js';

/** A function that communicates with model using */
export async function promptService(generateContentFn) {
  const messages = prepareMessages(getCodeGenPrompt());

  // First stage: generate code generation summary, which should not take a lot of output tokens
  const prompt = [
    { type: 'systemPrompt', systemPrompt: getSystemPrompt() },
    { type: 'user', text: messages.suggestSourceCode },
    { type: 'assistant', text: messages.requestSourceCode, functionCalls: [{ name: 'getSourceCode' }] },
  ];

  const getSourceCodeResponse = {
    type: 'user',
    functionResponses: [{ name: 'getSourceCode', content: messages.sourceCode }],
    text: messages.prompt,
  };
  prompt.push(getSourceCodeResponse);

  const baseResult = await generateContentFn(
    prompt,
    functionDefs.filter((fd) => ['codegenSummary', 'explanation'].includes(fd.name)),
  );

  const codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary');

  if (codegenSummaryRequest) {
    // Second stage: for each file request the actual code updates
    console.log('Received codegen summary, will collect partial updates', codegenSummaryRequest.args);

    if (codegenSummaryRequest.args.contextPaths.length > 0 && !disableContextOptimization) {
      console.log('Optimize with context paths.');
      // Monkey patch the initial getSourceCode, do not send parts of source code that are consider irrelevant
      getSourceCodeResponse.functionResponses.find((item) => item.name === 'getSourceCode').content =
        messages.contextSourceCode(codegenSummaryRequest.args.contextPaths);
    }

    // Store the first stage response entirey in conversation history
    prompt.push({ type: 'assistant', functionCalls: baseResult });
    prompt.push({
      type: 'user',
      functionResponses: baseResult.map((call) => ({ name: call.name })),
    });

    const result = [];

    for (const path of codegenSummaryRequest.args.filePaths) {
      console.log('Collecting partial update for:', path);

      // this is needed, otherwise we will get an error
      if (prompt.slice(-1)[0].type === 'user') {
        prompt.slice(-1)[0].text = messages.partialPromptTemplate(path);
      } else {
        prompt.push({ type: 'user', text: messages.partialPromptTemplate(path) });
      }

      const partialResult = await generateContentFn(prompt, functionDefs);

      prompt.push(
        { type: 'assistant', functionCalls: partialResult },
        {
          type: 'user',
          functionResponses: partialResult.map((call) => ({ name: call.name })),
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
    prompt: prompt + '\n Start from generating codegen summary, this summary will be used to generate updates.',
    sourceCode: JSON.stringify(getSourceCode()),
    contextSourceCode: (paths) => JSON.stringify(getSourceCode(paths)),
    partialPromptTemplate(path) {
      return `Thank you for providing the summary, now show me the actual codegen instruction for \`${path}\` file.`;
    },
  };
}

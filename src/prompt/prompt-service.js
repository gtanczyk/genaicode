import { getSystemPrompt } from './systemprompt.js';
import { getCodeGenPrompt } from './prompt-codegen.js';
import { functionDefs } from '../ai-service/function-calling.js';
import { getSourceCode } from '../files/read-files.js';
import { disableContextOptimization } from '../cli/cli-params.js';

/** A function that communicates with model using */
export async function promptService(generateContentFn) {
  const messages = prepareMessages(getCodeGenPrompt());

  const basePrompt = [
    { type: 'systemPrompt', systemPrompt: getSystemPrompt() },
    { type: 'user', text: messages.suggestSourceCode },
    { type: 'assistant', text: messages.requestSourceCode, functionCall: { name: 'getSourceCode' } },
    { type: 'user', functionResponse: { name: 'getSourceCode', content: messages.sourceCode }, text: messages.prompt },
  ];

  const baseResult = await generateContentFn(
    basePrompt,
    functionDefs.filter((fd) => ['getSourceCode', 'codegenSummary', 'explanation'].includes(fd.name)),
  );

  if (baseResult.length === 1 && baseResult[0].name === 'codegenSummary') {
    console.log('Received codegen summary, will collect partial updates', baseResult[0].args);

    if (baseResult[0].args.contextPaths.length > 0 && !disableContextOptimization) {
      console.log('Optimize with context paths.');
      basePrompt.find((item) => item.functionResponse?.name === 'getSourceCode').functionResponse.content =
        messages.contextSourceCode(baseResult[0].args.contextPaths);
    }

    const result = [];

    for (const path of baseResult[0].args.filePaths) {
      console.log('Collecting partial update for:', path);
      const partialResult = await generateContentFn(
        [
          ...basePrompt,
          { type: 'assistant', functionCall: { name: 'codegenSummary', args: baseResult[0].args } },
          { type: 'user', functionResponse: { name: 'codegenSummary' }, text: messages.partialPromptTemplate(path) },
        ],
        functionDefs,
      );

      result.push(...partialResult);
    }

    return result;
  } else {
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
    prompt: prompt + '\n Start from generating codegen summary.',
    sourceCode: JSON.stringify(getSourceCode()),
    contextSourceCode: (paths) => JSON.stringify(getSourceCode(paths)),
    partialPromptTemplate(path) {
      return `Thank you for providing the summary, now show me the actual codegen instruction for \`${path}\` file.`;
    },
  };
}

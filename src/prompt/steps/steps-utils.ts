import { PromptItem } from '../../ai-service/common.js';

export function getSourceCodeResponse(prompt: PromptItem[]) {
  const getSourceCodeResponse = prompt.find(
    (item) => item.type === 'user' && item.functionResponses?.some((resp) => resp.name === 'getSourceCode'),
  );

  if (getSourceCodeResponse && getSourceCodeResponse.functionResponses) {
    const sourceCodeResponseIndex = getSourceCodeResponse.functionResponses.findIndex(
      (resp) => resp.name === 'getSourceCode',
    );
    if (sourceCodeResponseIndex !== -1) {
      return getSourceCodeResponse.functionResponses[sourceCodeResponseIndex];
    }
  }

  return null;
}

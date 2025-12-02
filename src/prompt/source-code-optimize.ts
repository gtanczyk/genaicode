import { PromptItem } from '../ai-service/common-types';

export function optimizeSourceCodeForPrompt(rootDir: string, prompt: PromptItem[]): PromptItem[] {
  const clone = JSON.parse(JSON.stringify(prompt)) as PromptItem[];

  for (const item of clone) {
    for (const response of item.functionResponses || []) {
      if (response.name === 'getSourceCode') {
        try {
          const sourceCode = JSON.parse(response.content || '{}') as Record<
            string,
            { fileId: string; content?: string | null }
          >;
          const optimizedSourceCode: Record<string, { fileId: string; content?: string | null }> & {
            rootDir?: string;
          } = {};

          for (const [filePath, fileData] of Object.entries(sourceCode)) {
            const relativePath = filePath.startsWith(rootDir) ? filePath.substring(rootDir.length + 1) : filePath;
            optimizedSourceCode[relativePath] = fileData;
            if (fileData.content === null) {
              delete optimizedSourceCode[relativePath].content;
            }
          }

          optimizedSourceCode.rootDir = rootDir;

          response.content = JSON.stringify(optimizedSourceCode);
        } catch (e) {
          console.warn(`Failed to optimize source code in prompt for item ${item.type}:`, e);
        }
      }
    }
  }

  return clone;
}

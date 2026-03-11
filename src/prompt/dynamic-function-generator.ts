import fs from 'node:fs';
import { getGenerateContentFunctions } from '../main/codegen.js';
import { ModelType } from '../ai-service/common-types.js';
import { AiServiceType, CodegenOptions } from '../main/codegen-types.js';
import { getSystemPrompt } from './systemprompt.js';
import { rcConfig } from '../main/config.js';

export async function generateDynamicFunction(
  prompt: string,
  argsLength: number,
  functionName: string,
  aiService: AiServiceType,
  codegenOptions: CodegenOptions,
  callingFilePath?: string,
): Promise<string> {
  try {
    const generateContentFns = getGenerateContentFunctions();
    if (!generateContentFns[aiService]) {
      throw new Error(`AI service ${aiService} is not available`);
    }
    const generateContentFn = generateContentFns[aiService];

    const argsSignature = Array.from({ length: argsLength })
      .map((_, i) => `arg${i + 1}: any`)
      .join(', ');

    const baseSystemPrompt = getSystemPrompt(rcConfig, codegenOptions);

    const systemPrompt = `${baseSystemPrompt}
You are a code generator. You must implement a JavaScript/TypeScript function that matches the user's intent. 
The function MUST be named "${functionName}".
It MUST NOT be wrapped in markdown code blocks.
It MUST be a valid exported function declaration.
It MUST support the following argument signature: (${argsSignature}).`;

    let userPrompt = `Implement a function that does the following: "${prompt}".`;

    if (callingFilePath && fs.existsSync(callingFilePath)) {
      const callingFileContent = fs.readFileSync(callingFilePath, 'utf-8');
      userPrompt += `\n\nHere is the context of the file where this function will be called (\`${callingFilePath}\`):
\`\`\`typescript
${callingFileContent}
\`\`\`
Use this context to infer appropriate types and structure for the generated function.`;
    }

    const result = await generateContentFn(
      [
        { type: 'systemPrompt', systemPrompt },
        { type: 'user', text: userPrompt },
      ],
      {
        temperature: 0.1,
        modelType: ModelType.DEFAULT,
        expectedResponseType: { text: true, functionCall: false, media: false },
      },
      codegenOptions,
    );

    const textResponse = result.find((r) => r.type === 'text');
    if (!textResponse || !textResponse.text) {
      throw new Error('Failed to generate code: No text response from AI');
    }

    let code = textResponse.text.trim();
    if (code.startsWith('```')) {
      code = code.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');
    }

    if (!code.startsWith('export ')) {
      code = 'export ' + code;
    }

    return code;
  } catch (error) {
    console.error('Error generating dynamic function:', error);
    throw error;
  }
}

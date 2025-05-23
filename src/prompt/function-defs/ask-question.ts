import { FunctionDef } from '../../ai-service/common-types.js';
import { rcConfig } from '../../main/config.js';
import { getRegisteredActionHandlerDescriptions, getRegisteredActionHandlers } from '../../main/plugin-loader.js';

function getActionTypeDescription(): string {
  const pluginDescriptions = Array.from(getRegisteredActionHandlerDescriptions().entries())
    .map(([actionType, description]) => ` - ${actionType}: ${description}`)
    .join('\n');

  return `This value instructs the program on what should happen next.

Detailed Explanation of actionTypes:
- sendMessage: Use for general information, clarifications, or when no specific code is needed, or when there is a need to analyze something.
- generateImage: Use this action only if there is a need to generate an image based on the conversation, and then display it to the user.
- updateFile: Use to update a single file that exists already with a new content, **AFTER you have already obtained the file content using \`requestFilesContent\` if necessary**. This action is suitable for small changes. The user will be able to see the diff and approve or reject the change. Then you will be able to continue the conversation.
- createFile: Use to create a new file with the provided content. The user will be able to see the new file and approve or reject the change. Then you will be able to continue the conversation.
- performAnalysis: Use when there's a need to analyze complex problems or data that requires enhanced context or more expensive computation. This action supports both code and image analysis with customizable context and parameters.
- requestPermissions: Use **only when you lack necessary permissions** for actions like creating, deleting, or moving files, and need to request them from the user.
- requestFilesContent: Use specifically when needing to access or review the contents of files, and it is **not already present in the \`sourceCode\`**. Only use this action if the file content is genuinely missing after the \`getSourceCode\` function response.
- readExternalFiles: Use to request access to **read the content of specific files** located outside the project's root directory. User confirmation is required for the batch of external files. Only processed information (summary or extracted facts) will be returned, not the raw file content. **This function is for getting the *contents* of known external files, not for listing directory contents.**
- exploreExternalDirectories: Use to **list files and subdirectories within directories** located outside the project's root directory.  You can specify criteria to filter the files (recursive, depth, search phrases). User confirmation is required. **This function returns a list of file paths, allowing you to explore directory structures.**
${rcConfig.featuresEnabled?.gitContext !== false ? '- requestGitContext: Use to request Git context information like recent commits, file changes, blame output, or file diffs for specific files/commits.' : ''}
- removeFilesFromContext: Use to remove unnecessary file contents from context, optimizing token usage.
- contextOptimization: Use to manage and optimize context during code generation tasks, allowing the LLM to provide guidance on what parts of the context are most relevant to keep.
- contextCompression: Use to compress the context by removing unnecessary tokens and optimizing the context size while maintaining essential information.
- searchCode: Use to search through source code files with flexible filtering. Supports searching in file contents and names, with pattern matching and case sensitivity options. Useful for finding specific code patterns or references across the codebase.
- confirmCodeGeneration: Use to confirm with the user before starting the main, multi-step code generation workflow for implementing features or significant code changes requiring analysis and potentially intertwined modifications across multiple files.
- endConversation: Use to stop the conversation.
- requestFilesFragments: Use to request fragments (specific parts) of files based on a given prompt. This is useful when you need only certain sections of files, not their entire content.
${
  rcConfig.featuresEnabled?.appContext
    ? `- pullAppContext: Use to retrieve application context values for use in the conversation. This allows accessing shared state between the application and GenAIcode.
- pushAppContext: Use to update application context values based on conversation outcomes. This enables persisting conversation results back to the application.`
    : ''
}
- conversationGraph: Use for complex conversations needing multiple steps and decisions.
- compoundAction: Use when the user's request implies multiple *distinct*, *predefined* file operations (create, update, delete, move) or image manipulations that can be batched as a single logical step *within* the conversation flow. This action triggers an internal AI call to generate a list of specific operations based on the user's request, which is then shown to the user for confirmation before execution. **Important**: This is *not* for complex feature implementation or tasks requiring significant analysis and intertwined code generation (use **confirmCodeGeneration** for those instead).
${rcConfig.lintCommand ? '- lint: Use to check the code for errors and provide feedback on the quality of the code.' : ''}
${pluginDescriptions}
- genaicodeHelp: Use to provide help to the user on how to use GenAIcode. The response will be grounded in the content of GenAIcode's documentation.
- reasoningInference: Use to perform an inference on a reasoning model. Should be used when a in-depth reasoning is needed for a specific problem.

This value must be derived from the value of \`decisionMakingProcess\` parameter, and must be one of the above values.`;
}

export const actionTypeOptions: string[] = [
  'sendMessage',
  'generateImage',
  'updateFile',
  'createFile',
  'performAnalysis',
  'requestPermissions',
  'requestFilesContent',
  'readExternalFiles',
  'exploreExternalDirectories',
  ...(rcConfig.featuresEnabled?.gitContext !== false ? ['requestGitContext'] : ''),
  'removeFilesFromContext',
  'contextOptimization',
  'contextCompression',
  'searchCode',
  'confirmCodeGeneration',
  'endConversation',
  'requestFilesFragments',
  ...(rcConfig.featuresEnabled?.appContext ? ['pullAppContext', 'pushAppContext'] : []),
  ...(rcConfig.lintCommand ? ['lint'] : []),
  ...Array.from(getRegisteredActionHandlers().keys()),
  'genaicodeHelp',
  'reasoningInference',
  'conversationGraph',
  'compoundAction',
];

/**
 * Function definition for askQuestion
 *
 * Use this function to ask questions, seek clarification, request file permissions, or manage the flow of the conversation.
 * Each actionType serves a specific purpose, ensuring clarity and proper task execution.
 */
export const getAskQuestionDef = (): FunctionDef => ({
  name: 'askQuestion',
  description: `Use this function to interact with the user for various purposes.
The \`decisionMakingProcess\` must be provided as first parameter to ensure clarity in decision-making, and impact on selection of \`actionType\` and \`message\`.
The \`decisionMakingProcess\` value must contain the following sections: Contextual Analysis, Options Evaluation, Decision Justification, Minimal Action Selection, Evaluation of Action Choice
The \`actionType\` must be chosen based on the decision-making process, and the desired outcome.
The \`message\` property must align with the chosen \`actionType\`.

**IMPORTANT**: 
- Mind the order of the parameters, as the decision-making process must be provided first to ensure clarity in decision-making.
- All parameters are required for this function to work properly.
  `,
  parameters: {
    type: 'object',
    properties: {
      decisionMakingProcess: {
        type: 'string',
        description: `A detailed reasoning framework describing how you chose the action.
The decisionMakingProcess value **MUST** be provided in the following **EXACT** format:

\`\`\`
1. **Contextual Analysis**:
    Assess the current information, including available permissions,
    the current context, and task requirements. Identify any missing elements
    that are critical to task completion.
  
2. **Options Evaluation**:
    For every action type think how this action can help in the current context. Provide reasoning for each action type in such format:
    \`\`\`
${actionTypeOptions.map((actionType) => `      - ${actionType}: <reasoning>`).join('\n')}
    \`\`\`

3. **Decision Justification**:
    State the reasoning for the proposed action, considering whether planning,
    clarification, or a direct action is required. If there's any ambiguity,
    prefer a confirmatory action (e.g., "confirmCodeGeneration").

4. **Minimal Action Selection**:
    Determine the minimal action that can make progress toward the task goal.
    Avoid requesting unnecessary permissions or context that isn't strictly needed.

5. **Evaluation of Action Choice**:
    Double-check if the selected action aligns with the task requirements
    and the user-provided constraints.
  \`\`\``,
      },
      actionType: {
        type: 'string',
        enum: actionTypeOptions,
        description: getActionTypeDescription(),
      },
      message: {
        type: 'string',
        description: 'The message to display to the user.',
      },
    },
    required: ['decisionMakingProcess', 'actionType', 'message'],
  },
});

// sendMessage
export const sendMessage: FunctionDef = {
  name: 'sendMessage',
  description: 'Use this function to send a message to the user.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to display to the user.',
      },
    },
    required: ['message'],
  },
};

// requestFilesContent
export const requestFilesContent: FunctionDef = {
  name: 'requestFilesContent',
  description: 'Use this function to request the content of files that are missing from the `sourceCode`.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        minLength: 1,
        description: 'An array of absolute file paths for which you need the content.',
      },
    },
    required: ['filePaths'],
  },
};

// requestFilesFragments
export const requestFilesFragments: FunctionDef = {
  name: 'requestFilesFragments',
  description:
    'Use this function to request fragments of files based on a given prompt. The prompt will be used to extract relevant information from the files.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        minLength: 1,
        description: 'An array of absolute file paths for which you need to extract fragments.',
      },
      fragmentPrompt: {
        type: 'string',
        description: 'A prompt describing what information should be extracted from the files.',
      },
    },
    required: ['filePaths', 'fragmentPrompt'],
  },
};

// removeFilesFromContext
export const removeFilesFromContext: FunctionDef = {
  name: 'removeFilesFromContext',
  description: 'Use this function to remove files from the context that are no longer needed for code generation.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        minLength: 1,
        description: 'An array of absolute file paths to remove from the context.',
      },
    },
    required: ['filePaths'],
  },
};

// contextOptimization
export const contextOptimization: FunctionDef = {
  name: 'contextOptimization',
  description:
    'Use this function to optimize the context for code generation by specifying which parts are most relevant to keep.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The prompt used to guide the user in optimizing the context.',
      },
    },
    required: ['prompt'],
  },
};

// requestPermissions
export const requestPermissions: FunctionDef = {
  name: 'requestPermissions',
  description: 'Use this function to request additional permissions needed for code generation if not already granted.',
  parameters: {
    type: 'object',
    properties: {
      allowDirectoryCreate: {
        description: 'Request permission to create directories.',
        type: 'boolean',
      },
      allowFileCreate: {
        description: 'Request permission to create files.',
        type: 'boolean',
      },
      allowFileDelete: {
        description: 'Request permission to delete files.',
        type: 'boolean',
      },
      allowFileMove: {
        description: 'Request permission to move files.',
        type: 'boolean',
      },
      enableVision: {
        description: 'Request permission for vision capabilities, using images as context for code generation.',
        type: 'boolean',
      },
      enableImagen: {
        description: 'Request permission to generate images.',
        type: 'boolean',
      },
    },
    required: [
      'allowDirectoryCreate',
      'allowFileCreate',
      'allowFileDelete',
      'allowFileMove',
      'enableVision',
      'enableImagen',
    ],
  },
};

// searchCode
export const searchCode: FunctionDef = {
  name: 'searchCode',
  description: 'Use this function to search through source code files with flexible filtering.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string',
      },
      includePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional glob patterns to include files',
      },
      excludePatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional glob patterns to exclude files',
      },
      searchInContent: {
        type: 'boolean',
        description: 'Whether to search in file contents (default: true)',
      },
      searchInFilenames: {
        type: 'boolean',
        description: 'Whether to search in file names (default: true)',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case sensitive search (default: false)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50)',
      },
      contextLines: {
        type: 'number',
        description: 'Number of context lines to include around content matches (default: 2)',
      },
    },
    required: ['query'],
  },
};

// lint
export const lint: FunctionDef = {
  name: 'lint',
  description: 'Use this function to run lint command, and get output.',
  parameters: {
    type: 'object',
    properties: {
      filePaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'An array of absolute file paths to lint. If not provided, all files will be linted.',
      },
    },
    required: [],
  },
};

// pullAppContext
export const pullAppContext: FunctionDef = {
  name: 'pullAppContext',
  description: 'Use this function to retrieve application context values for use in the conversation.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key of the context value to retrieve.',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for retrieving this context value.',
      },
    },
    required: ['key'],
  },
};

// pushAppContext
export const pushAppContext: FunctionDef = {
  name: 'pushAppContext',
  description: 'Use this function to update application context values based on conversation outcomes.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key of the context value to update.',
      },
      value: {
        type: 'string',
        description: 'The value to store in the context. This must be a valid json string.',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for updating this context value.',
      },
    },
    required: ['key', 'value'],
  },
};

// requestGitContext
export const requestGitContextDef: FunctionDef = {
  name: 'requestGitContext',
  description:
    'Use this function to request Git context information like recent commits, file changes, blame output, or file diffs.',
  parameters: {
    type: 'object',
    properties: {
      requestType: {
        type: 'string',
        enum: ['commits', 'fileChanges', 'blame', 'fileDiff'],
        description: 'The type of Git information to request.',
      },
      filePath: {
        type: 'string',
        description: "The absolute file path required for 'fileChanges', 'blame', and 'fileDiff' requests.",
      },
      commitHash: {
        type: 'string',
        description: "The specific commit hash for 'blame' and 'fileDiff' requests.",
      },
      count: {
        type: 'number',
        description: "The number of recent commits to retrieve for 'commits' requests.",
      },
    },
    required: ['requestType'],
  },
};

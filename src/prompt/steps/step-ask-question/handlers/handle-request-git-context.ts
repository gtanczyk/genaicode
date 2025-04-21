import simpleGit, { SimpleGit, LogResult, DefaultLogFields } from 'simple-git';
import { ActionHandler, ActionHandlerProps, ActionResult, RequestGitContextArgs } from '../step-ask-question-types.js';
import { rcConfig } from '../../../../main/config.js';
import path from 'node:path';
import { getFunctionDefs } from '../../../function-calling.js';
import { ModelType, PromptItem } from '../../../../ai-service/common-types.js'; // Import PromptItem
import { putSystemMessage } from '../../../../main/common/content-bus.js';

// Helper function to format log output
function formatLog(log: LogResult<DefaultLogFields>): string {
  return log.all
    .map((commit) => `- ${commit.hash.substring(0, 7)} by ${commit.author_name} on ${commit.date}: ${commit.message}`)
    .join('\n');
}

// Helper function to format blame output
function formatBlame(blame: string): string {
  // Basic formatting, could be enhanced
  return `\nBlame Output:\n${blame}`;
}

// Helper function to format diff output
function formatDiff(diff: string): string {
  return `\nDiff Output:\n${diff}`;
}

// Define the detailed instruction prompt for the LLM
export const GIT_CONTEXT_INSTRUCTION_PROMPT = `
    You need to call the 'requestGitContext' function. Please determine the appropriate arguments based on the user's request.
    Parameters:
    - requestType (required): Choose one of 'commits', 'fileChanges', 'blame', or 'fileDiff'.
      - 'commits': Get recent commit history for the entire repository.
      - 'fileChanges': Get commit history specifically for the given 'filePath'.
      - 'blame': Get line-by-line authorship information (git blame) for the given 'filePath'.
      - 'fileDiff': Get the changes made to a specific 'filePath' in a given 'commitHash'.
    - filePath (absolute, required for 'fileChanges', 'blame', and 'fileDiff'): The absolute path to the file within the project. IMPORTANT: Ensure the provided filePath is absolute and is inside of the project root and exists within the project directory structure.
    - commitHash (required for 'blame' and 'fileDiff'): A specific commit hash to focus the request.
    - count (required for 'commits' and 'fileChanges'): The maximum number of commits to retrieve (applies mainly to 'commits' and 'fileChanges').

    Analyze the user's request and provide the arguments accurately.
  `;

export const handleRequestGitContext: ActionHandler = async ({
  askQuestionCall,
  options,
  generateContentFn,
  prompt,
}: ActionHandlerProps): Promise<ActionResult> => {
  putSystemMessage('Handling requestGitContext action.');

  // Create a temporary prompt array including the instruction
  const inferencePrompt: PromptItem[] = [
    ...prompt,
    { type: 'user', text: GIT_CONTEXT_INSTRUCTION_PROMPT }, // Add instruction as a user message
  ];

  const [requestGitContextCall] = // Use the temporary prompt with instructions for this specific call
    (
      await generateContentFn(
        inferencePrompt, // Use the temporary prompt with the instruction
        {
          functionDefs: getFunctionDefs(),
          requiredFunctionName: 'requestGitContext',
          temperature: 0.7,
          modelType: ModelType.CHEAP,
          expectedResponseType: { text: false, functionCall: true, media: false },
        },
        options,
      )
    )
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall);

  if (!requestGitContextCall?.args) {
    putSystemMessage('No valid requestGitContext call found after inference.');
    // Add the original assistant message back, but indicate failure
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'Could not determine the correct parameters for the Git request based on your message.',
      },
    );
    return {
      breakLoop: false,
      items: [],
    };
  }

  putSystemMessage('Inferred requestGitContext call', requestGitContextCall);

  // Add the original assistant message and the inferred function call to the main prompt
  prompt.push({
    type: 'assistant',
    text: askQuestionCall.args?.message ?? '',
    functionCalls: [requestGitContextCall],
  });

  const args = requestGitContextCall.args as RequestGitContextArgs;

  const git: SimpleGit = simpleGit(rcConfig.rootDir);
  let responseContent = '';
  let errorMessage = '';

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error('The project directory is not a Git repository.');
    }

    // Common validation for file path
    const validateFilePath = (requiredFor: string) => {
      if (!args.filePath) {
        throw new Error(`filePath is required for ${requiredFor} request.`);
      }
      if (!path.isAbsolute(args.filePath)) {
        throw new Error(`filePath must be an absolute path for ${requiredFor} request.`);
      }
      const absoluteFilePath = args.filePath;
      if (!absoluteFilePath.startsWith(rcConfig.rootDir)) {
        throw new Error(`Access denied: filePath is outside the project root for ${requiredFor} request.`);
      }
      return absoluteFilePath;
    };

    // Common validation for commit hash
    const validateCommitHash = (requiredFor: string) => {
      if (!args.commitHash) {
        throw new Error(`commitHash is required for ${requiredFor} request.`);
      }
      return args.commitHash;
    };

    switch (args.requestType) {
      case 'commits': {
        const logOptions: Record<string, unknown> = {};
        if (args.count && args.count > 0) {
          logOptions['--max-count'] = args.count;
        }
        const log = await git.log(logOptions);
        responseContent = `Recent commits:\n${formatLog(log)}`;
        break;
      }
      case 'fileChanges': {
        const absoluteFilePath = validateFilePath('fileChanges');
        const logOptions: Record<string, unknown> = { file: absoluteFilePath };
        if (args.count && args.count > 0) {
          logOptions['--max-count'] = args.count;
        }
        const log = await git.log(logOptions);
        responseContent = `Changes for ${args.filePath}:\n${formatLog(log)}`;
        break;
      }
      case 'blame': {
        const absoluteFilePath = validateFilePath('blame');
        const blameCommandArgs: string[] = ['blame'];
        if (args.commitHash) {
          // Include the commit hash in the command arguments before the file path
          blameCommandArgs.push(args.commitHash);
        }
        // Use '--' to clearly separate the commit/options from the file path
        blameCommandArgs.push('--', absoluteFilePath);

        const blame = await git.raw(...blameCommandArgs);
        responseContent = `Blame for ${args.filePath}${args.commitHash ? ` at commit ${args.commitHash.substring(0, 7)}` : ''}:\n${formatBlame(blame)}`;
        break;
      }
      case 'fileDiff': {
        const absoluteFilePath = validateFilePath('fileDiff');
        const commitHash = validateCommitHash('fileDiff');
        // Use commitHash~1...commitHash to get the diff for that specific commit
        const diff = await git.diff([`${commitHash}~1..${commitHash}`, '--', absoluteFilePath]);
        responseContent = `Diff for ${args.filePath} at commit ${commitHash.substring(0, 7)}:\n${formatDiff(diff)}`;
        break;
      }
      default: {
        // Should be caught by function call validation, but handle defensively
        throw new Error(`Invalid requestType received: ${args.requestType}`);
      }
    }
  } catch (error: unknown) {
    console.error('Error fetching Git context:', error);
    errorMessage =
      error instanceof Error
        ? `Error fetching Git context: ${error.message}`
        : 'An unknown error occurred while fetching Git context.';
  }

  putSystemMessage('Git context response', {
    responseContent,
    errorMessage,
  });

  // Add the function response (result or error) to the main prompt
  prompt.push({
    type: 'user',
    functionResponses: [
      {
        name: 'requestGitContext', // Use the actual function name
        call_id: requestGitContextCall.id,
        content: errorMessage || responseContent,
        isError: !!errorMessage,
      },
    ],
  });

  return {
    breakLoop: false,
    items: [],
  };
};

import simpleGit, { SimpleGit, LogResult, DefaultLogFields } from 'simple-git';
import { ActionHandler, ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { rcConfig } from '../../../../main/config.js';
import path from 'node:path';
import { getFunctionDefs } from '../../../function-calling.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';

type RequestGitContextArgs = {
  requestType: 'commits' | 'fileChanges' | 'blame';
  filePath?: string;
  commitHash?: string;
  count?: number;
};

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

export const handleRequestGitContext: ActionHandler = async ({
  askQuestionCall,
  options,
  generateContentFn,
  prompt,
}: ActionHandlerProps): Promise<ActionResult> => {
  putSystemMessage('Handling requestGitContext action.');

  const [requestGitContextCall] = (
    await generateContentFn(
      prompt,
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
    putSystemMessage('No valid requestGitContext call found.');
    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args?.message ?? '',
      },
      {
        type: 'user',
        text: 'No valid requestGitContext call found.',
      },
    );
    return {
      breakLoop: false,
      items: [],
    };
  }

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
        if (!args.filePath) {
          throw new Error('filePath is required for fileChanges request.');
        }
        const absoluteFilePath = path.resolve(rcConfig.rootDir, args.filePath);
        // Ensure the path is within the project root
        if (!absoluteFilePath.startsWith(rcConfig.rootDir)) {
          throw new Error('Access denied: filePath is outside the project root.');
        }
        const log = await git.log({ file: absoluteFilePath });
        responseContent = `Changes for ${args.filePath}:\n${formatLog(log)}`;
        break;
      }
      case 'blame': {
        if (!args.filePath) {
          throw new Error('filePath is required for blame request.');
        }
        const absoluteFilePath = path.resolve(rcConfig.rootDir, args.filePath);
        // Ensure the path is within the project root
        if (!absoluteFilePath.startsWith(rcConfig.rootDir)) {
          throw new Error('Access denied: filePath is outside the project root.');
        }
        const blameOptions: string[] = [];
        if (args.commitHash) {
          // Potentially add commit range if needed, simple-git blame might not directly support single commit blame easily
          // For now, we just pass the file path.
          // A more robust implementation might need `git.raw` for specific blame commands.
          console.warn('commitHash specific blame is not fully implemented, showing full blame.');
        }
        const blame = await git.raw('blame', absoluteFilePath, ...blameOptions);
        responseContent = `Blame for ${args.filePath}:\n${formatBlame(blame)}`;
        break;
      }
      default: {
        throw new Error(`Invalid requestType: ${args.requestType}`);
      }
    }
  } catch (error: unknown) {
    console.error('Error fetching Git context:', error);
    errorMessage =
      error instanceof Error
        ? `Error fetching Git context: ${error.message}`
        : 'An unknown error occurred while fetching Git context.';
  }

  prompt.push({
    type: 'user',
    text: responseContent || errorMessage,
    functionResponses: [
      {
        name: errorMessage
          ? 'I encountered an error when trying to get the Git information'
          : 'Here is the Git information you requested',
        call_id: requestGitContextCall.id,
        content: errorMessage || responseContent,
      },
    ],
  });

  return {
    breakLoop: false,
    items: [],
  };
};

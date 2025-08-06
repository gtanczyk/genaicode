import Docker from 'dockerode';
import { FunctionCall, GenerateContentArgs, PromptItem } from '../../../../ai-service/common-types.js';
import { 
  ActionHandler, 
  ActionHandlerProps, 
  RunContainerTaskArgs,
  RunCommandArgs,
  CompleteTaskArgs,
  FailTaskArgs
} from '../step-ask-question-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { Stream } from 'node:stream';
import { getFunctionDefs } from '../../../function-calling.js';
import { runCommandDef, completeTaskDef, failTaskDef } from '../../../function-defs/container-task-commands.js';

export const handleRunContainerTask: ActionHandler = async ({ 
  askQuestionCall, 
  prompt, 
  generateContentFn, 
  options 
}: ActionHandlerProps) => {
  try {
    putSystemMessage('Container task: generating proper task request');

    // First, use generateContentFn to get the proper runContainerTask arguments
    const request: GenerateContentArgs = [
      [
        ...prompt,
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
      ],
      {
        functionDefs: getFunctionDefs(),
        requiredFunctionName: 'runContainerTask',
        temperature: 0.7,
        modelType: ModelType.CHEAP,
        expectedResponseType: {
          text: false,
          functionCall: true,
          media: false,
        },
      },
      options,
    ];

    const [runContainerTaskCall] = (await generateContentFn(...request))
      .filter((item) => item.type === 'functionCall')
      .map((item) => item.functionCall) as [FunctionCall<RunContainerTaskArgs> | undefined];

    if (!runContainerTaskCall?.args?.image || !runContainerTaskCall.args.taskDescription) {
      putSystemMessage('❌ Failed to get valid runContainerTask request');
      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
        },
        {
          type: 'user',
          text: 'Failed to get valid runContainerTask request',
        },
      );
      return { breakLoop: false, items: [] };
    }

    const { image, taskDescription } = runContainerTaskCall.args;
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });

    putSystemMessage(`🐳 Starting container task with image: ${image}`);

    try {
      await pullImage(docker, image);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ Failed to pull Docker image: ${errorMessage}`);
      
      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: `Failed to pull Docker image: ${errorMessage}`,
            },
          ],
        },
      );
      return { breakLoop: false, items: [] };
    }

    let container: Docker.Container | undefined;
    try {
      container = await docker.createContainer({
        Image: image,
        Tty: true,
        Cmd: ['/bin/sh'],
        HostConfig: {
          AutoRemove: true,
        },
      });
      await container.start();
      putSystemMessage(`✅ Container started successfully (ID: ${container.id.substring(0, 12)})`);

      const { taskExecutionPrompt, success, summary } = await commandExecutionLoop(
        container, 
        taskDescription, 
        generateContentFn,
        options
      );

      const finalMessage = `✅ Task finished with status: ${success ? 'Success' : 'Failed'}.

**Summary:**
${summary}`;

      putSystemMessage(finalMessage);

      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: finalMessage,
            },
          ],
        },
        ...taskExecutionPrompt,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ An error occurred during the container task: ${errorMessage}`);
      
      prompt.push(
        {
          type: 'assistant',
          text: askQuestionCall.args!.message,
          functionCalls: [runContainerTaskCall],
        },
        {
          type: 'user',
          functionResponses: [
            {
              name: 'runContainerTask',
              call_id: runContainerTaskCall.id || undefined,
              content: `An error occurred during the container task: ${errorMessage}`,
            },
          ],
        },
      );
    } finally {
      if (container) {
        try {
          putSystemMessage('Stopping and removing container...');
          await container.stop();
          // AutoRemove is true, so no need to remove explicitly
          putSystemMessage('✅ Container stopped and removed.');
        } catch (error) {
          // Ignore errors during cleanup, as the container might already be gone.
        }
      }
    }

    return { breakLoop: false, items: [] };
  } catch (error) {
    // Handle errors gracefully
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`Error during container task initialization: ${errorMessage}`);

    prompt.push(
      {
        type: 'assistant',
        text: askQuestionCall.args!.message,
      },
      {
        type: 'user',
        text: `Error during container task initialization.`,
      },
    );

    return {
      breakLoop: true,
      items: [],
    };
  }
};

async function pullImage(docker: Docker, image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    putSystemMessage(`PULLING DOCKER IMAGE: ${image} (this may take a while)...`);
    docker.pull(image, (err: Error, stream: Stream) => {
      if (err) {
        return reject(err);
      }
      docker.modem.followProgress(stream as any, (err: Error | null) => {
        if (err) {
          return reject(err);
        }
        putSystemMessage(`✅ Image "${image}" pulled successfully.`);
        resolve();
      });
    });
  });
}

async function commandExecutionLoop(
  container: Docker.Container,
  taskDescription: string,
  generateContentFn: ActionHandlerProps['generateContentFn'],
  options: ActionHandlerProps['options'],
): Promise<{ taskExecutionPrompt: PromptItem[]; success: boolean; summary: string }> {
  let commandHistory = '';
  let success = false;
  let summary = '';
  const maxCommands = 25;
  const taskExecutionPrompt: PromptItem[] = [];

  // Build the initial context for the command execution loop
  const initialContext = [
    {
      type: 'user' as const,
      text: `You are an expert system operator inside a Docker container. Your task is to complete the following objective by executing shell commands one at a time.

Overall Task:
${taskDescription}

You have access to the following functions:
- runCommand(command, reasoning): Execute a shell command in the container
- completeTask(summary): Mark the task as successfully completed with a summary
- failTask(reason): Mark the task as failed with a reason

Execute commands step by step to complete the task. After each command, you will see the output and can decide on the next command. When the task is complete or if you determine it cannot be completed, use the appropriate completion function.

Current command history:
${commandHistory || 'No commands executed yet.'}`,
    },
  ];

  for (let i = 0; i < maxCommands; i++) {
    try {
      const [actionResult] = (await generateContentFn(
        initialContext.concat(taskExecutionPrompt),
        {
          functionDefs: [runCommandDef, completeTaskDef, failTaskDef],
          temperature: 0.7,
          modelType: ModelType.CHEAP,
          expectedResponseType: {
            text: false,
            functionCall: true,
            media: false,
          },
        },
        options,
      ))
        .filter((item) => item.type === 'functionCall')
        .map((item) => item.functionCall) as [FunctionCall<RunCommandArgs | CompleteTaskArgs | FailTaskArgs> | undefined];

      if (!actionResult) {
        putSystemMessage('❌ Internal LLM failed to produce a valid function call.');
        summary = 'Task failed: AI system could not determine next action';
        break;
      }

      if (actionResult.name === 'completeTask') {
        const args = actionResult.args as CompleteTaskArgs;
        putSystemMessage('✅ Task marked as complete by internal operator.');
        success = true;
        summary = args.summary;
        
        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: 'Completing the task.',
            functionCalls: [actionResult],
          },
          {
            type: 'user',
            functionResponses: [
              {
                name: 'completeTask',
                call_id: actionResult.id || undefined,
                content: 'Task completed successfully.',
              },
            ],
          },
        );
        break;
      }

      if (actionResult.name === 'failTask') {
        const args = actionResult.args as FailTaskArgs;
        putSystemMessage('❌ Task marked as failed by internal operator.');
        success = false;
        summary = args.reason;
        
        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: 'Failing the task.',
            functionCalls: [actionResult],
          },
          {
            type: 'user',
            functionResponses: [
              {
                name: 'failTask',
                call_id: actionResult.id || undefined,
                content: 'Task marked as failed.',
              },
            ],
          },
        );
        break;
      }

      if (actionResult.name === 'runCommand') {
        const args = actionResult.args as RunCommandArgs;
        const { command, reasoning } = args;

        if (i === maxCommands - 1) {
          putSystemMessage('⚠️ Reached maximum command limit.');
          summary = 'Task incomplete: Reached maximum command limit';
          break;
        }

        putSystemMessage(`Executing command: \`\`\`sh\n${command}\n\`\`\``);
        putSystemMessage(`Reasoning: ${reasoning}`);

        const { output, exitCode } = await executeCommandInContainer(container, command);

        const logEntry = `$ ${command}\n${output}\nExit Code: ${exitCode}\n\n`;
        commandHistory += logEntry;
        
        // Cap history to keep the context manageable
        if (commandHistory.length > 4096) {
          commandHistory = commandHistory.slice(commandHistory.length - 4096);
        }

        // Update the initial context with new command history
        initialContext[0].text = `You are an expert system operator inside a Docker container. Your task is to complete the following objective by executing shell commands one at a time.

Overall Task:
${taskDescription}

You have access to the following functions:
- runCommand(command, reasoning): Execute a shell command in the container
- completeTask(summary): Mark the task as successfully completed with a summary
- failTask(reason): Mark the task as failed with a reason

Execute commands step by step to complete the task. After each command, you will see the output and can decide on the next command. When the task is complete or if you determine it cannot be completed, use the appropriate completion function.

Current command history:
${commandHistory}`;

        taskExecutionPrompt.push(
          {
            type: 'assistant',
            text: `Executing command with reasoning: ${reasoning}`,
            functionCalls: [actionResult],
          },
          {
            type: 'user',
            functionResponses: [
              {
                name: 'runCommand',
                call_id: actionResult.id || undefined,
                content: `Command executed successfully.\n\nOutput:\n${output}\n\nExit Code: ${exitCode}`,
              },
            ],
          },
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      putSystemMessage(`❌ Error during command execution loop: ${errorMessage}`);
      summary = `Task failed: Error during execution - ${errorMessage}`;
      break;
    }
  }

  if (!summary) {
    summary = success ? 'Task completed' : 'Task failed or incomplete';
  }

  return { taskExecutionPrompt, success, summary };
}

async function executeCommandInContainer(
  container: Docker.Container,
  command: string,
): Promise<{ output: string; exitCode: number }> {
  const exec = await container.exec({
    Cmd: ['/bin/sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: true, stdin: true });
  const output = await demuxDockerStream(stream);
  const { ExitCode: exitCode } = await exec.inspect();

  return { output, exitCode: exitCode ?? 0 };
}

async function demuxDockerStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let output = '';
    stream.on('data', (chunk) => {
      // The Docker stream prefixes each chunk with an 8-byte header:
      // 1 byte for stream type (1 for stdout, 2 for stderr),
      // 3 unused bytes, and 4 bytes for the size of the payload.
      // We can ignore the header for this simple implementation and just decode the payload.
      output += chunk.toString('utf8').substring(8);
    });
    stream.on('end', () => resolve(output));
  });
}



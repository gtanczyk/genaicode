import Docker from 'dockerode';
import { ActionHandler, RunContainerTaskArgs } from '../step-ask-question-types.js';
import { putSystemMessage } from '../../../../main/common/content-bus.js';
import { ModelType } from '../../../../ai-service/common-types.js';
import { Stream } from 'node:stream';

export const handleRunContainerTask: ActionHandler = async ({ askQuestionCall, generateContentFn }) => {
  const { image, taskDescription } = askQuestionCall.args as RunContainerTaskArgs;
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });

  putSystemMessage(`🐳 Starting container task with image: ${image}`);

  try {
    await pullImage(docker, image);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`❌ Failed to pull Docker image: ${errorMessage}`);
    return { breakLoop: true, items: [] };
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

    const { fullLog, success } = await commandExecutionLoop(container, taskDescription, generateContentFn);

    const summary = await generateFinalSummary(taskDescription, fullLog, generateContentFn);

    putSystemMessage(
      `✅ Task finished with status: ${success ? 'Success' : 'Failed'}.

**Summary:**
${summary}`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`❌ An error occurred during the container task: ${errorMessage}`);
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

  return { breakLoop: true, items: [] };
};

async function pullImage(docker: Docker, image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    putSystemMessage(`PULLING DOCKER IMAGE: ${image} (this may take a while)...`);
    docker.pull(image, (err: Error, stream: Stream) => {
      if (err) {
        return reject(err);
      }
      docker.modem.followProgress(stream, (err: Error | null) => {
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
  generateContentFn: (typeof handleRunContainerTask extends ActionHandler
    ? Parameters<ActionHandler>[0]
    : never)['generateContentFn'],
): Promise<{ fullLog: string; success: boolean }> {
  let commandHistory = '';
  let fullLog = '';
  let success = false;
  const maxCommands = 25;

  for (let i = 0; i < maxCommands; i++) {
    const nextCommandPrompt = `You are an expert system operator inside a Docker container.
Based on the overall task and the history of commands executed so far, determine the single next shell command to run.
If the task is complete, respond with "TASK_COMPLETE".
If you cannot determine the next step, respond with "TASK_FAILED".

Overall Task:
${taskDescription}

Command History (stdout/stderr):
${commandHistory}

Next command:`;

    const [nextCommandResult] = await generateContentFn(
      [{ type: 'user', text: nextCommandPrompt }],
      { modelType: ModelType.CHEAP, expectedResponseType: { text: true, functionCall: false } },
      {},
    );

    if (nextCommandResult.type !== 'text') {
      putSystemMessage('❌ Internal LLM failed to produce a text response for the next command.');
      return { fullLog, success: false };
    }

    const command = nextCommandResult.text.trim();

    if (command === 'TASK_COMPLETE') {
      putSystemMessage('✅ Task marked as complete by internal operator.');
      success = true;
      break;
    }
    if (command === 'TASK_FAILED') {
      putSystemMessage('❌ Task marked as failed by internal operator.');
      success = false;
      break;
    }
    if (i === maxCommands - 1) {
      putSystemMessage('⚠️ Reached maximum command limit.');
      break;
    }

    putSystemMessage(`Executing command: \`\`\`sh\n${command}\n\`\`\``);
    const { output, exitCode } = await executeCommandInContainer(container, command);

    const logEntry = `$ ${command}\n${output}\nExit Code: ${exitCode}\n\n`;
    fullLog += logEntry;
    commandHistory += logEntry;
    // Cap history to keep the internal prompt concise
    if (commandHistory.length > 4096) {
      commandHistory = commandHistory.slice(commandHistory.length - 4096);
    }
  }
  return { fullLog, success };
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

  return { output, exitCode };
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

async function generateFinalSummary(
  taskDescription: string,
  fullLog: string,
  generateContentFn: (typeof handleRunContainerTask extends ActionHandler
    ? Parameters<ActionHandler>[0]
    : never)['generateContentFn'],
): Promise<string> {
  const summaryPrompt = `Based on the following task description and the full command log, provide a concise summary of the outcome.
Highlight key results, successes, and any errors encountered.

Task Description:
${taskDescription}

Full Command Log:
${fullLog}

Summary:`;

  const [summaryResult] = await generateContentFn(
    [{ type: 'user', text: summaryPrompt }],
    { modelType: ModelType.DEFAULT, expectedResponseType: { text: true, functionCall: false } },
    {},
  );

  if (summaryResult.type === 'text') {
    return summaryResult.text;
  }
  return 'Failed to generate summary.';
}

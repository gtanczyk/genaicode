import { docker } from './docker-client.js';
import { runCommandDef } from './run-command-def.js';
import { OperationExecutor } from '../../main/codegen-types.js';
import { putAssistantMessage } from '../../main/common/content-bus.js';
import { liteLLMSummarizer } from '../../ai-service/lite-llm-summarizer.js';
import type { GenerateContentFunction } from '../../ai-service/common-types.js';
import type { Stream } from 'node:stream';

const MAX_LINES = 500;
const MAX_BYTES = 16 * 1024; // 16 KB

interface RunCommandArgs {
  containerId: string;
  cmd: string;
  /** The generateContent function from the prompt service, passed by the handler. */
  generateContent: GenerateContentFunction;
}

/**
 * Captures the output from a stream, with limits on bytes and lines.
 * @param stream The stream to capture from.
 * @returns A promise that resolves to the captured output and a truncation flag.
 */
async function captureOutput(stream: Stream): Promise<{ output: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    let output = '';
    let byteLength = 0;
    let lineCount = 0;
    let truncated = false;

    // The stream from `exec.start` when TTY is true is a raw stream.
    stream.on('data', (chunk: Buffer) => {
      if (truncated) {
        return;
      }
      const chunkString = chunk.toString('utf8');

      // Check byte limit
      if (byteLength + chunk.length > MAX_BYTES) {
        const remainingBytes = MAX_BYTES - byteLength;
        output += chunk.slice(0, remainingBytes).toString('utf8');
        truncated = true;
        return; // Stop processing
      }

      output += chunkString;
      byteLength += chunk.length;

      // Check line limit
      lineCount = (output.match(/\n/g) || []).length;
      if (lineCount > MAX_LINES) {
        output = output.split('\n').slice(0, MAX_LINES).join('\n');
        truncated = true;
      }
    });

    stream.on('end', () => {
      resolve({ output, truncated });
    });

    stream.on('error', (err) => {
      console.error('Stream error during command execution:', err);
      // Rejecting the promise to be caught by the main try-catch block
      reject(new Error(`Stream error during command execution: ${err.message}`));
    });
  });
}

export const executor: OperationExecutor = async (args) => {
  const { containerId, cmd, generateContent } = args as RunCommandArgs;

  if (typeof generateContent !== 'function') {
    throw new Error('`generateContent` function was not provided to the `runCommand` executor.');
  }

  try {
    const container = docker.getContainer(containerId);
    // inspect to see if container exists
    await container.inspect();

    putAssistantMessage(`Running command in container ${containerId.substring(0, 12)}: "${cmd}"`);

    const exec = await container.exec({
      Cmd: ['/bin/sh', '-c', cmd], // Use shell to handle complex commands with pipes, etc.
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    const { output: rawOutput, truncated } = await captureOutput(stream);

    const inspectInfo = await exec.inspect();
    const exitCode = inspectInfo.ExitCode;

    const summary = await liteLLMSummarizer(generateContent, rawOutput);

    const result = {
      exitCode,
      summary,
      truncated,
    };

    putAssistantMessage(`Command finished with exit code ${exitCode ?? 'N/A'}.`, result);
  } catch (error: unknown) {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
      if ((error as any).statusCode === 404) {
        errorMessage = `Container with ID '${containerId}' not found.`;
      }
    } else {
      errorMessage = String(error);
    }

    console.error(`Error running command in container:`, error);
    putAssistantMessage(`Error running command: ${errorMessage}`, { error: errorMessage }, [], undefined);
  }
};

export const def = runCommandDef;

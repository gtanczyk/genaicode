import { docker } from './docker-client.js';
import { startContainerDef } from './start-container-def.js';
import { OperationExecutor } from '../../main/codegen-types.js';
import { putAssistantMessage } from '../../main/common/content-bus.js';
import type { Stream } from 'node:stream';

interface StartContainerArgs {
  image: string;
  name?: string;
}

/**
 * Promisified version of docker.pull to handle the stream.
 * @param image The Docker image to pull.
 */
async function pullImage(image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    putAssistantMessage(`Pulling Docker image: ${image}... (this may take a moment)`);
    docker.pull(image, (err: Error | undefined, stream: Stream) => {
      if (err) {
        return reject(err);
      }
      docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });
}

export const executor: OperationExecutor = async (args) => {
  const { image, name } = args as StartContainerArgs;

  try {
    await pullImage(image);
    putAssistantMessage(`Image '${image}' pulled successfully.`);

    putAssistantMessage(`Creating container from image: ${image}...`);
    const container = await docker.createContainer({
      Image: image,
      name,
      // Keep the container running so we can exec into it later
      Tty: true,
      Cmd: ['/bin/sh'],
      HostConfig: {
        AutoRemove: true,
      },
    });

    await container.start();
    const containerInfo = await container.inspect();

    const response = {
      id: containerInfo.Id,
      // The name is returned with a leading slash, remove it.
      name: containerInfo.Name.startsWith('/') ? containerInfo.Name.substring(1) : containerInfo.Name,
      status: containerInfo.State.Status,
    };

    putAssistantMessage('Container started successfully.', response);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error starting container:', error);
    putAssistantMessage(`Error starting container: ${errorMessage}`, { error: errorMessage }, [], undefined);
  }
};

export const def = startContainerDef;

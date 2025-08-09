import Docker from 'dockerode';
import { putSystemMessage } from '../main/common/content-bus.js';
import { AllowedDockerImage } from '../prompt/function-defs/run-container-task.js';

/**
 * Pull a Docker image
 */
export async function pullImage(docker: Docker, image: AllowedDockerImage): Promise<void> {
  putSystemMessage(`🐳 Pulling Docker image: ${image}`);

  return new Promise((resolve, reject) => {
    docker
      .pull(image)
      .then((stream) => {
        docker.modem.followProgress(stream, (err) => {
          if (err) {
            reject(err);
          } else {
            putSystemMessage(`✅ Successfully pulled Docker image: ${image}`);
            resolve();
          }
        });
      })
      .catch((error) => {
        putSystemMessage(`❌ Failed to pull Docker image: ${error.message}`);
        reject(error);
      });
  });
}

/**
 * Create and start a Docker container
 */
export async function createAndStartContainer(docker: Docker, image: AllowedDockerImage): Promise<Docker.Container> {
  const container = await docker.createContainer({
    Image: image,
    Tty: true,
    Cmd: ['/bin/sh'],
    HostConfig: {
      AutoRemove: true,
    },
  });

  await container.start();
  putSystemMessage(`✅ Container started successfully (ID: ${container.id.substring(0, 12)})`);

  return container;
}

/**
 * Execute a command in a Docker container
 */
export async function executeCommand(
  container: Docker.Container,
  command: string,
): Promise<{ output: string; exitCode: number }> {
  const exec = await container.exec({
    Cmd: ['/bin/sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({});
  let output = '';

  // Collect output from the stream
  await new Promise<void>((resolve) => {
    stream.on('data', (chunk: Buffer) => {
      // Docker stream format: first 8 bytes are header, rest is data
      const data = chunk.slice(8).toString();
      output += data;
    });

    stream.on('end', () => {
      resolve();
    });
  });

  const inspect = await exec.inspect();
  return { output: output.trim(), exitCode: inspect.ExitCode || 0 };
}

/**
 * Stop and clean up a Docker container
 */
export async function stopContainer(container: Docker.Container): Promise<void> {
  try {
    await container.stop();
    putSystemMessage('🛑 Container stopped successfully');
  } catch (error) {
    // Container might already be stopped, which is fine
    putSystemMessage('🛑 Container cleanup completed');
  }
}

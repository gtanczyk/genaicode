import Docker from 'dockerode';
import path from 'path';
import fs from 'fs';
import tar from 'tar-stream';
import { putSystemMessage } from '../main/common/content-bus.js';
import { AllowedDockerImage } from '../prompt/function-defs/run-container-task.js';
import { rcConfig } from '../main/config.js';
import {
  cacheContainerId,
  clearCachedContainerIds,
  getCachedContainerIds,
  removeCachedContainerId,
} from '../files/cache-file.js';

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
  cacheContainerId(container.id);
  putSystemMessage(`✅ Container started successfully (ID: ${container.id.substring(0, 12)})`);

  return container;
}

/**
 * Execute a command in a Docker container
 */
export async function executeCommand(
  container: Docker.Container,
  command: string,
  stdin: string | undefined,
  workingDir: string,
  abortSignal?: AbortSignal,
): Promise<{ output: string; exitCode: number }> {
  const exec = await container.exec({
    Cmd: ['/bin/sh', '-c', command],
    WorkingDir: workingDir,
    AttachStdin: true,
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: true, stdin: true });
  if (stdin) {
    stream.write(stdin);
  }
  stream.end();

  abortSignal?.addEventListener('abort', async () => {
    await executeCommand(container, `pkill -9 -f "${command}"`, '', '/');
    stream.destroy();
  });

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

  if (abortSignal?.aborted) {
    output += '\n\nAborted command execution';
  }

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
  } finally {
    removeCachedContainerId(container.id);
  }
}

/**
 * Clean up orphaned containers left over from previous runs.
 */
export async function cleanupOrphanedContainers(docker: Docker): Promise<void> {
  const containerIds = getCachedContainerIds();
  if (containerIds.length === 0) {
    return;
  }

  putSystemMessage(`🧹 Found ${containerIds.length} potentially orphaned containers. Cleaning up...`);

  const cleanupPromises = containerIds.map(async (id) => {
    try {
      const container = docker.getContainer(id);
      const inspectInfo = await container.inspect();
      if (inspectInfo.State.Running) {
        await container.stop();
        putSystemMessage(`🛑 Stopped orphaned container ${id.substring(0, 12)}`);
      }
    } catch (error) {
      // Ignore errors (e.g., container not found)
    }
  });

  await Promise.all(cleanupPromises);
  clearCachedContainerIds();
  putSystemMessage('✅ Orphaned container cleanup complete.');
}

/**
 * Validates that the host path is within the project root directory.
 * @param hostPath The path on the host machine. Can be absolute or relative to the project root.
 * @returns The absolute, validated path.
 */
function validateHostPath(hostPath: string): string {
  const absoluteHostPath = path.resolve(rcConfig.rootDir, hostPath);
  if (!absoluteHostPath.startsWith(rcConfig.rootDir)) {
    throw new Error(`Invalid host path: ${hostPath} is outside the project root directory.`);
  }
  return absoluteHostPath;
}

/**
 * Recursively adds files and directories to a tar pack stream.
 * @param pack The tar-stream pack instance.
 * @param directoryPath The absolute path of the directory to add.
 * @param relativeTo The base path for entries in the tar archive.
 */
function addDirectoryToPack(pack: tar.Pack, directoryPath: string, relativeTo: string) {
  const items = fs.readdirSync(directoryPath);

  for (const item of items) {
    const fullPath = path.join(directoryPath, item);
    const tarPath = path.join(relativeTo, item);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      addDirectoryToPack(pack, fullPath, tarPath);
    } else if (stats.isFile()) {
      pack.entry({ name: tarPath }, fs.readFileSync(fullPath));
    }
  }
}

/**
 * Copy a file or directory from the host to the container.
 */
export async function copyToContainer(
  container: Docker.Container,
  hostPath: string,
  containerPath: string,
): Promise<void> {
  try {
    const absoluteHostPath = validateHostPath(hostPath);
    putSystemMessage(`📦 Copying from host:${absoluteHostPath} to container:${containerPath}`);

    const pack = tar.pack();
    const stats = fs.statSync(absoluteHostPath);

    if (stats.isDirectory()) {
      addDirectoryToPack(pack, absoluteHostPath, '');
    } else {
      pack.entry({ name: path.basename(hostPath) }, fs.readFileSync(absoluteHostPath));
    }
    pack.finalize();

    await container.putArchive(pack, { path: containerPath });
    putSystemMessage(`✅ Successfully copied to container.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`❌ Failed to copy to container: ${errorMessage}`);
    throw error;
  }
}

/**
 * Lists the files within a container archive without extracting them.
 */
export async function listFilesInContainerArchive(
  container: Docker.Container,
  containerPath: string,
): Promise<string[]> {
  const files: string[] = [];
  try {
    const stream = await container.getArchive({ path: containerPath });
    const extract = tar.extract();

    extract.on('entry', (header, stream, next) => {
      // We only care about files, not directories
      if (header.type === 'file') {
        files.push(header.name);
      }
      stream.on('end', () => next());
      stream.resume(); // Discard the stream's data
    });

    await new Promise<void>((resolve, reject) => {
      extract.on('finish', resolve);
      extract.on('error', reject);
      stream.pipe(extract);
    });

    return files;
  } catch (error) {
    // If the path doesn't exist, getArchive throws an error. Return an empty list.
    return [];
  }
}

/**
 * Copy a file or directory from the container to the host.
 */
export async function copyFromContainer(
  container: Docker.Container,
  containerPath: string,
  hostPath: string,
): Promise<void> {
  try {
    const absoluteHostPath = validateHostPath(hostPath);
    putSystemMessage(`📦 Copying from container:${containerPath} to host:${absoluteHostPath}`);

    const stream = await container.getArchive({ path: containerPath });
    const extract = tar.extract();

    extract.on('entry', (header, stream, next) => {
      const filePath = path.join(absoluteHostPath, header.name);
      const dir = path.dirname(filePath);

      if (header.type === 'directory') {
        if (!fs.existsSync(filePath)) {
          fs.mkdirSync(filePath, { recursive: true });
        }
        stream.on('end', () => next());
        stream.resume();
        return;
      }

      // Ensure directory exists for the file
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const writeStream = fs.createWriteStream(filePath);
      stream.pipe(writeStream);

      // Only call next() after the file has been fully written
      writeStream.on('finish', () => next());
      writeStream.on('error', (err) => {
        console.error(`Error writing file ${filePath}:`, err);
        next(err); // Pass error to tar-stream
      });
      stream.on('error', (err) => {
        console.error(`Error in tar stream for ${filePath}:`, err);
        next(err); // Pass error to tar-stream
      });
    });

    await new Promise<void>((resolve, reject) => {
      extract.on('finish', resolve);
      extract.on('error', reject);
      stream.pipe(extract);
    });
    putSystemMessage(`✅ Successfully copied from container.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    putSystemMessage(`❌ Failed to copy from container: ${errorMessage}`);
    throw error;
  }
}

export async function checkPathExistsInContainer(container: Docker.Container, containerPath: string): Promise<boolean> {
  const check = await executeCommand(container, `ls ${containerPath}`, '', '/');
  return check.exitCode === 0;
}

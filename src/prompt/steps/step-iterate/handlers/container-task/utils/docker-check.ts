import Docker from 'dockerode';

/**
 * Check if Docker is available
 */

export async function checkDockerAvailability(): Promise<boolean> {
  try {
    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    await docker.ping();
    return true;
  } catch (error) {
    return false;
  }
}

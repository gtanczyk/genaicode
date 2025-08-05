import Docker from 'dockerode';

/**
 * A singleton instance of the Dockerode client.
 * It connects to the Docker daemon via the standard Unix socket.
 */
export const docker = new Docker({ socketPath: '/var/run/docker.sock' });

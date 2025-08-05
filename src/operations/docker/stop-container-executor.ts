import { docker } from './docker-client.js';
import { stopContainerDef } from './stop-container-def.js';
import { OperationExecutor } from '../../main/codegen-types.js';
import { putAssistantMessage } from '../../main/common/content-bus.js';

interface StopContainerArgs {
  containerId: string;
}

export const executor: OperationExecutor = async (args) => {
  const { containerId } = args as StopContainerArgs;

  try {
    const container = docker.getContainer(containerId);

    // First, inspect to ensure the container exists before we try to operate on it.
    await container.inspect();

    putAssistantMessage(`Stopping container ${containerId.substring(0, 12)}...`);
    // Stop the container. A 304 status code means it's already stopped, which is not an error.
    await container.stop().catch((err) => {
      if (err.statusCode === 304) {
        putAssistantMessage(`Container ${containerId.substring(0, 12)} was already stopped.`);
        return; // Continue to removal
      }
      throw err; // Re-throw other errors
    });

    putAssistantMessage(`Removing container ${containerId.substring(0, 12)}...`);
    await container.remove();

    putAssistantMessage(`Container ${containerId.substring(0, 12)} stopped and removed successfully.`);
  } catch (error: unknown) {
    let errorMessage: string;
    // Handle specific dockerode errors
    if (error instanceof Error && (error as any).statusCode) {
      const statusCode = (error as any).statusCode;
      if (statusCode === 404) {
        // Container doesn't exist, which is a success case for this operation.
        errorMessage = `Container ${containerId.substring(0, 12)} not found. It may have already been removed.`;
        putAssistantMessage(errorMessage);
        return; // Exit gracefully
      }
      errorMessage = `Docker API error (status ${statusCode}): ${error.message}`;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = String(error);
    }

    console.error(`Error stopping or removing container ${containerId}:`, error);
    putAssistantMessage(`Error stopping container: ${errorMessage}`, { error: errorMessage }, [], undefined);
  }
};

export const def = stopContainerDef;

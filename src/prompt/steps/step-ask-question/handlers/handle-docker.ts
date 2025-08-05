import { ActionHandler } from '../step-ask-question-types.js';
import { getOperationExecutor } from '../../../../operations/operations-index.js';
import { CodegenOptions } from '../../../../main/codegen-types.js';
import { featuresEnabled } from '../../../../main/config.js';

// Get the operation executors once at module load time.
const startContainerExecutor = getOperationExecutor('startContainer');
const runCommandExecutor = getOperationExecutor('runCommand');
const stopContainerExecutor = getOperationExecutor('stopContainer');

function checkDockerEnabled() {
  if (!featuresEnabled.docker) {
    throw new Error(
      'Docker operations are disabled. Please enable the "docker" feature flag in your .genaicoderc file.',
    );
  }
}

/**
 * Action handler for the 'startContainer' operation.
 */
export const handleStartContainer: ActionHandler = async (params) => {
  checkDockerEnabled();
  if (!startContainerExecutor) {
    throw new Error('The "startContainer" operation is not registered.');
  }
  const args = params.askQuestionCall.args;
  await startContainerExecutor(args, params.options as CodegenOptions);
};

/**
 * Action handler for the 'runCommand' operation.
 * This handler is special because it passes the `generateContent` function
 * to the executor, which needs it for the summarization step.
 */
export const handleRunCommand: ActionHandler = async (params) => {
  checkDockerEnabled();
  if (!runCommandExecutor) {
    throw new Error('The "runCommand" operation is not registered.');
  }
  const args = {
    ...params.askQuestionCall.args,
    generateContent: params.generateContent, // Pass the generateContent function
  };
  await runCommandExecutor(args, params.options as CodegenOptions);
};

/**
 * Action handler for the 'stopContainer' operation.
 */
export const handleStopContainer: ActionHandler = async (params) => {
  checkDockerEnabled();
  if (!stopContainerExecutor) {
    throw new Error('The "stopContainer" operation is not registered.');
  }
  const args = params.askQuestionCall.args;
  await stopContainerExecutor(args, params.options as CodegenOptions);
};

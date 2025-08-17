import { AllowedDockerImage } from '../../../../function-defs/run-container-task.js';

/**
 * Arguments for the runContainerTask action
 */
export type RunContainerTaskArgs = {
  image: AllowedDockerImage;
  taskDescription: string;
};

/**
 * Arguments for the runCommand action in container tasks
 */
export type RunCommandArgs = {
  command: string;
  stdin?: string;
  truncMode: 'start' | 'end';
  workingDir: string;
  reasoning: string;
};

/**
 * Arguments for the completeTask action in container tasks
 */
export type CompleteTaskArgs = {
  summary: string;
};

/**
 * Arguments for the failTask action in container tasks
 */
export type FailTaskArgs = {
  reason: string;
};

/** New utility action args */
export type WrapContextArgs = { summary: string };
export type SetExecutionPlanArgs = { plan: string };
export type UpdateExecutionPlanArgs = { progress: string };
export type SendMessageArgs = { message: string; isQuestion: boolean };

export type CopyToContainerArgs = {
  hostPath: string;
  containerPath: string;
};
export type CopyFromContainerArgs = {
  containerPath: string;
  hostPath: string;
};

import { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';
import { registerActionHandler } from '../step-ask-question-handlers.js';
import { runContainerTaskOrchestrator } from './container-task/container-task-orchestrator.js';

export async function handleRunContainerTask(props: ActionHandlerProps): Promise<ActionResult> {
  return runContainerTaskOrchestrator(props);
}

registerActionHandler('runContainerTask', handleRunContainerTask);

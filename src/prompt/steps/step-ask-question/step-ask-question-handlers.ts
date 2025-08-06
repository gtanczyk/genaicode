import { ActionType, ActionHandler } from './step-ask-question-types.js';
import { handleRunContainerTask } from './handlers/handle-run-container-task.js';

export const handlers: Partial<Record<ActionType, ActionHandler>> = {};

export function registerActionHandler(type: ActionType, handler: ActionHandler): void {
  handlers[type] = handler;
}

registerActionHandler('runContainerTask', handleRunContainerTask);

import { ActionType, ActionHandler } from './step-ask-question-types.js';
import { handleStartContainer, handleRunCommand, handleStopContainer } from './handlers/handle-docker.js';

export const handlers: Partial<Record<ActionType, ActionHandler>> = {};

export function registerActionHandler(type: ActionType, handler: ActionHandler): void {
  handlers[type] = handler;
}

// Register Docker action handlers.
// The string literals are cast to ActionType because the full enum/type definition
// is not available in this context, but they correspond to the action names.
registerActionHandler('startContainer' as ActionType, handleStartContainer);
registerActionHandler('runCommand' as ActionType, handleRunCommand);
registerActionHandler('stopContainer' as ActionType, handleStopContainer);

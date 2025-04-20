import { ActionType, ActionHandler } from './step-ask-question-types.js';
import { handleRequestGitContext } from './handlers/handle-request-git-context.js';

export const handlers: Partial<Record<ActionType, ActionHandler>> = {
  requestGitContext: handleRequestGitContext,
};

export function registerActionHandler(type: ActionType, handler: ActionHandler): void {
  handlers[type] = handler;
}

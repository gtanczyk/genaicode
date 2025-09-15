import { ActionType, ActionHandler } from './step-ask-question-types.js';
import './handlers/handle-project-command.js';

export const handlers: Partial<Record<ActionType, ActionHandler>> = {};

export function registerActionHandler(type: ActionType, handler: ActionHandler): void {
  handlers[type] = handler;
}

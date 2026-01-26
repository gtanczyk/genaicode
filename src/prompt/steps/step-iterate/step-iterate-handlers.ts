import { ActionType, ActionHandler } from './step-iterate-types.js';

export const handlers: Partial<Record<ActionType, ActionHandler>> = {};

export function registerActionHandler(type: ActionType, handler: ActionHandler): void {
  handlers[type] = handler;
}

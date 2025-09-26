import { ActionHandler } from './step-ask-question-types.js';
import { ActionType } from '../../../ai-service/common-types.js';

export const handlers: Partial<Record<ActionType, ActionHandler>> = {};

export function registerActionHandler(type: ActionType, handler: ActionHandler): void {
  handlers[type] = handler;
}

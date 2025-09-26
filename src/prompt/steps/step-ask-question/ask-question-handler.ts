import { getRegisteredActionHandlers } from '../../../main/plugin-loader.js';
import { handlers } from './step-ask-question-handlers.js';
import { ActionHandler } from './step-ask-question-types';
import { ActionType } from '../../../ai-service/common-types.js';

export function getActionHandler(actionType: ActionType): ActionHandler {
  // First, check if there's a plugin-provided handler for this action type
  const pluginHandler = getRegisteredActionHandlers().get(actionType as `plugin:${string}`);
  if (pluginHandler) {
    return pluginHandler;
  }

  // If no plugin handler is found, use the built-in handlers
  return handlers[actionType] ?? handlers['sendMessage']!;
}

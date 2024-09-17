import { registerConfirmHandler, registerInputHandler } from '../common/user-actions.js';
import { Service } from './backend/service.js';

export function registerUserActionHandlers(service: Service) {
  registerInputHandler((_, message) => service.askQuestion(message, false));
  registerConfirmHandler(async (message: string) => {
    const response = await service.askQuestion(message, true);
    return response.toLowerCase() === 'yes';
  });
}

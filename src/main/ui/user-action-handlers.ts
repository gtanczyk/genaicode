import { registerConfirmHandler, registerInputHandler } from '../common/user-actions.js';
import { Service } from './backend/service.js';

export function registerUserActionHandlers(service: Service) {
  registerInputHandler((_, message) => service.askQuestion(message, undefined).then((response) => response.answer));
  registerConfirmHandler(async (message: string, includeAnswer: boolean) => {
    const response = await service.askQuestion(message, { includeAnswer });
    return response;
  });
}

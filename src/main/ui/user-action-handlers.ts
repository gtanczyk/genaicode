import { registerConfirmHandler, registerInputHandler } from '../common/user-actions.js';
import { Service } from './backend/service.js';

export function registerUserActionHandlers(service: Service) {
  registerInputHandler((_, message) => service.askQuestion(message));
  registerConfirmHandler(
    async (message: string /*, defaultValue: boolean*/) => (await service.askQuestion(message)) === 'yes',
  );
}

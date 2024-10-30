import { registerConfirmHandler, registerInputHandler } from '../common/user-actions.js';
import { Service } from './backend/service.js';

export function registerUserActionHandlers(service: Service) {
  registerInputHandler((_, message) => service.askQuestion(message, undefined));
  registerConfirmHandler(async (props) => {
    const response = await service.askQuestion(props.prompt, {
      defaultValue: props.defaultValue,
      includeAnswer: props.includeAnswer,
      confirmLabel: props.confirmLabel,
      declineLabel: props.declineLabel,
    });
    return response;
  });
}

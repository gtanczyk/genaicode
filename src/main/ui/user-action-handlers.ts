import { registerConfirmHandler, registerInputHandler, registerSecretHandler } from '../common/user-actions.js';
import { Service } from './backend/service.js';

export function registerUserActionHandlers(service: Service) {
  registerInputHandler((_, message, promptActionType) =>
    service.askQuestion(message, {
      promptActionType,
    }),
  );
  registerConfirmHandler(async (props) => {
    const response = await service.askQuestion(props.prompt, {
      defaultValue: props.defaultValue,
      includeAnswer: props.includeAnswer,
      confirmLabel: props.confirmLabel,
      declineLabel: props.declineLabel,
    });
    return response;
  });
  registerSecretHandler(async (prompt) => {
    const res = await service.askQuestion(prompt, {
      secret: true,
    });
    return res?.answer || undefined;
  });
}

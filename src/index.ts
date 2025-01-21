export * from './main/codegen-types.js';
export * from './ai-service/common-types.js';
export * from './prompt/steps/step-ask-question/step-ask-question-types.js';
export * from './main/common/content-bus.js';
export * from './prompt/steps/steps-types.js';
export * from './main/common/user-actions.js';

export async function getRcConfig() {
  const { rcConfig } = await import('./main/config.js');
  return rcConfig;
}

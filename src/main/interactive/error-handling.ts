import { UserAction, handleCodegenError } from './common.js';

export async function handleError(error: unknown): Promise<void> {
  console.error('An error occurred:');

  if (error instanceof Error) {
    console.error(error.message);
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
  } else {
    console.error(String(error));
  }

  let action: UserAction;

  if (isCodegenError(error)) {
    action = await handleCodegenError(error);
  } else {
    action = await handleGeneralError();
  }

  handleErrorAction(action);
}

function isCodegenError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'CodegenError';
}

async function handleGeneralError(): Promise<UserAction> {
  console.log('An unexpected error occurred. Returning to main menu.');
  return 'main_menu';
}

function handleErrorAction(action: UserAction): void {
  switch (action) {
    case 're_run':
      console.log('Re-running the last operation...');
      // Logic to re-run the last operation should be implemented here
      break;
    case 'main_menu':
      console.log('Returning to main menu...');
      break;
    default:
      console.log('Invalid action. Returning to main menu...');
  }
}

export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodegenError';
  }
}

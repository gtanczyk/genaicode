import readline from 'readline';

export const handleUserInterrupt = (abortController: AbortController): Promise<void> => {
  return new Promise((resolve) => {
    const rl = createReadlineInterface();
    console.log('\nPress Ctrl+C to interrupt the operation...');

    const removeKeyPressHandler = setupKeyPressHandler(rl, abortController);

    rl.on('close', () => {
      removeKeyPressHandler();
      resolve();
    });

    abortController.signal.addEventListener(
      'abort',
      () => {
        rl.close();
        resolve();
      },
      { once: true },
    );
  });
};
const createReadlineInterface = () => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
};

const setupKeyPressHandler = (rl: readline.Interface, abortController: AbortController) => {
  const handleKeyPress = (str: string, key: { ctrl: boolean; name: string }) => {
    if (key.ctrl && key.name === 'c') {
      console.log('\nInterruption requested. Aborting operation...');
      abortController.abort();
      rl.close();
    }
  };

  process.stdin.on('keypress', handleKeyPress);

  return () => {
    process.stdin.removeListener('keypress', handleKeyPress);
  };
};

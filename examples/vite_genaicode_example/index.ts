import { contextManager } from '../../dist/vite-genaicode/vite-genaicode-context.js';

console.log('hello');

contextManager.setContext('testkey', 'testvalue');

setInterval(() => {
  contextManager.getContext('testkey').then((value) => {
    document.querySelector('#context-value')!.textContent = value as string;
  });
}, 1000);

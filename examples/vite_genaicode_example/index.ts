import { contextManager } from '../../dist/vite-genaicode/vite-genaicode-context.js';
// import { dynamicFunction } from 'genaicode:generator';

console.log('hello');

contextManager.setContext('testkey', 'testvalue');

setInterval(() => {
  contextManager.getContext('testkey').then((value) => {
    document.querySelector('#context-value')!.textContent = value as string;
  });
}, 1000);

async function runDynamicExample() {
  try {
    // const result = dynamicFunction('reverse the given string, and prefix with a random number', 'hello world');
    // console.log('Dynamic function result:', result);
    const div = document.createElement('div');
    // div.textContent = `Dynamic function result: ${result}`;
    document.body.appendChild(div);
  } catch (error) {
    console.error('Error running dynamic function:', error);
  }
}

runDynamicExample();

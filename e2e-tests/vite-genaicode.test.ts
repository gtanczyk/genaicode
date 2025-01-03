import { test, expect, beforeAll, afterAll, describe } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';

let browser: Browser;
let page: Page;
let genAICodeProcess: ChildProcess;

describe.concurrent('vite genaicode', () => {
  beforeAll(async () => {
    // Start GenAIcode in UI mode
    genAICodeProcess = spawn('npx', ['vite'], {
      cwd: path.resolve(__dirname, '..', 'examples', 'vite_genaicode_example'),
      env: { ...process.env, NODE_ENV: 'test', API_KEY: 'fake', NODE_DISABLE_COLORS: '1', NO_COLOR: 'true' },
      detached: true,
    });

    // Wait for the server to start and get the port
    const port = await new Promise<number>((resolve) => {
      genAICodeProcess.stdout!.on('data', (data) => {
        console.log(data.toString());
        const match = data.toString().match(/Local:(?:.+)http:\/\/localhost:(\d+)\//);
        if (match) {
          resolve(parseInt(match[1], 10));
        }
      });
      genAICodeProcess.stderr!.on('data', (data) => {
        console.log(data.toString());
      });
    });

    // Launch the browser
    console.log('Launching browser');
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    console.log('Creating new page');
    page = await browser.newPage();

    // Navigate to the GenAIcode UI
    console.log('Navigating to localhost');
    await page.goto(`http://localhost:${port}`);
  });

  test('GenAIcode UI is rendered', async () => {
    // Wait for the main container to be rendered
    console.log('Waiting for selector');
    await page.waitForSelector('genaicode-overlay >>>> .button');

    await page.click('genaicode-overlay >>>> .button');

    console.log('Waiting for iframe');
    const iframe = await page.waitForSelector('genaicode-overlay >>>> iframe');
    expect(iframe).not.toBeNull();

    const frame = await iframe!.contentFrame();
    expect(frame).not.toBeNull();

    const placeholderText = await frame.$eval('textarea[placeholder="Enter your input here"]', (el) =>
      el.getAttribute('placeholder'),
    );
    expect(placeholderText).toEqual('Enter your input here');
  });

  afterAll(async () => {
    // Close the browser
    if (browser) {
      await browser.close();
    }

    // Stop the GenAIcode process
    if (genAICodeProcess.pid) {
      process.kill(-genAICodeProcess.pid);
    }
  });
});

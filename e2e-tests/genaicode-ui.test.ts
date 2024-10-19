import { test, expect, beforeAll, afterAll, describe } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';

let browser: Browser;
let page: Page;
let genAICodeProcess: ChildProcess;

describe('genaicode ui', () => {
  beforeAll(async () => {
    // Start GenAIcode in UI mode
    genAICodeProcess = spawn('node', ['./bin/genaicode.cjs', '--ui', '--vertex-ai', '--force-dist'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test' },
    });

    // Wait for the server to start and get the port
    const port = await new Promise<number>((resolve) => {
      genAICodeProcess.stdout!.on('data', (data) => {
        const match = data.toString().match(/Server is running on http:\/\/localhost:(\d+)/);
        if (match) {
          resolve(parseInt(match[1], 10));
        }
      });
    });

    // Launch the browser
    browser = await puppeteer.launch();
    page = await browser.newPage();

    // Navigate to the GenAIcode UI
    await page.goto(`http://localhost:${port}`);
  });

  test('GenAIcode UI is rendered', async () => {
    // Wait for the main container to be rendered
    await page.waitForSelector('#root');

    // Check if the title is correct
    const title = await page.title();
    expect(title).toBe('GenAIcode - AI-Powered Code Generation');

    // Check if the main components are rendered
    const mainContainer = await page.$('#root');
    expect(mainContainer).not.toBeNull();

    // You can add more specific checks here, e.g., for specific buttons or elements
    const startButton = await page.$('textarea[placeholder="Enter your input here"]');
    expect(startButton).not.toBeNull();
  });

  afterAll(async () => {
    // Close the browser
    if (browser) {
      await browser.close();
    }

    // Stop the GenAIcode process
    if (genAICodeProcess) {
      genAICodeProcess.kill();
    }
  });
});

import { test, expect, beforeAll, afterAll, describe } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';

let browser: Browser;
let page: Page;
let genAICodeProcess: ChildProcess;

describe('vite genaicode', () => {
  beforeAll(async () => {
    // Start GenAIcode in UI mode
    genAICodeProcess = spawn('npx', ['vite'], {
      cwd: path.resolve(__dirname, '..', 'examples', 'vite_genaicode_example'),
      env: { ...process.env, NODE_ENV: 'test' },
      detached: true,
    });

    // Wait for the server to start and get the port
    const port = await new Promise<number>((resolve) => {
      genAICodeProcess.stdout!.on('data', (data) => {
        const match = data.toString().match(/Local:(?:.+)http:\/\/localhost:(\d+)\//);
        if (match) {
          resolve(parseInt(match[1], 10));
        }
      });
    });

    // Launch the browser
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=site-per-process'],
    });
    page = await browser.newPage();

    // Navigate to the GenAIcode UI
    await page.goto(`http://localhost:${port}`);
  });

  test('GenAIcode UI is rendered', async () => {
    // Wait for the main container to be rendered
    await page.waitForSelector('genaicode-overlay >>>> .button');

    await page.click('genaicode-overlay >>>> .button');

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

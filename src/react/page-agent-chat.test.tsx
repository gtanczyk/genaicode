// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageAgent, fakeLanguageModel, type PageTool } from '../browser.js';
import { PageAgentChat } from '../react.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label);

async function type(text: string) {
  const box = host.querySelector('textarea')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Send')!.click());
}

describe('<PageAgentChat>', () => {
  it('chats with the page agent and asks before a write tool', async () => {
    const run = vi.fn(() => 'theme is dark');
    const theme: PageTool = {
      name: 'set_theme',
      description: 'Switch the theme.',
      inputSchema: { type: 'object', properties: { theme: { type: 'string', enum: ['dark', 'light'] } } },
      write: true,
      summary: () => 'Switch the page to the dark theme',
      run,
    };
    const model = fakeLanguageModel([
      '{"action":"set_theme"}',
      '{"theme":"dark"}',
      '{"action":"reply"}',
      'It is **dark** now.',
    ]);
    const agent = createPageAgent({ name: 'wolf', tools: [theme], nano: { languageModel: model.factory } });
    await act(async () =>
      root.render(<PageAgentChat agent={agent} emptyState={<p>Ask the wolf</p>} foldSteps={false} />),
    );
    await tick();
    expect(host.textContent).toContain('Ask the wolf');
    expect(button('New')!.disabled).toBe(true);

    await type('go dark');
    await tick();
    expect(host.textContent).toContain('Switch the page to the dark theme');
    expect(run).not.toHaveBeenCalled();
    await act(async () => button('Approve')!.click());
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.gc-md strong')?.textContent).toBe('dark');
    expect(host.querySelector('.gc-limit')?.textContent).toBe('context 4%');
    expect(host.textContent).not.toContain('session');

    await act(async () => button('New')!.click());
    expect(host.textContent).toContain('Ask the wolf');
  });

  it('says so where the browser has no built-in model', async () => {
    const agent = createPageAgent({});
    await act(async () => root.render(<PageAgentChat agent={agent} emptyState={<p>Ask</p>} />));
    await tick();
    expect(host.textContent).toContain('needs a browser with a built-in AI model');
    expect(host.textContent).not.toContain('Ask');
    expect(host.querySelector('textarea')!.placeholder).toBe('Not available in this browser');
    expect(button('Send')!.disabled).toBe(true);
  });

  it('offers the download and shows its progress', async () => {
    let finish: () => void = () => {};
    const model = fakeLanguageModel(['ok'], { availability: 'downloadable' });
    const create = model.factory.create.bind(model.factory);
    model.factory.create = async (options = {}) => {
      const target = new EventTarget();
      options.monitor?.(target);
      target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 0.42 }));
      await new Promise<void>((resolve) => (finish = resolve));
      return create();
    };
    const agent = createPageAgent({ nano: { languageModel: model.factory } });
    await act(async () => root.render(<PageAgentChat agent={agent} />));
    await tick();
    expect(host.textContent).toContain('downloads the model once');
    await act(async () => button('Download the model')!.click());
    await tick();
    expect(host.textContent).toContain('Downloading the on-device model · 42%');
    await act(async () => finish());
    await tick();
    expect(host.textContent).not.toContain('Downloading');
    expect(button('Download the model')).toBeUndefined();
  });
});

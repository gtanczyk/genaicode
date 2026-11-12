// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageAgent, fakeLanguageModel, type PageTool } from '../browser.js';
import { matchesAccept, PageAgentChat } from '../react.js';

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

  it('attaches pasted and picked files, refuses what the model cannot take, and shows them on the turn', async () => {
    const model = fakeLanguageModel(['A cat on a sofa.'], { media: ['image'] });
    const agent = createPageAgent({ nano: { languageModel: model.factory, inputs: ['image', 'audio'] } });
    await act(async () => root.render(<PageAgentChat agent={agent} attachments />));
    await tick();
    const picker = host.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(picker.accept).toContain('image/*');
    expect(picker.accept).not.toContain('audio/*');
    // The model takes no audio here, so there is no microphone.
    expect(host.querySelector('[aria-label="Record a voice message"]')).toBeNull();

    const photo = new File([new Uint8Array(2048)], 'cat.png', { type: 'image/png' });
    const archive = new File([new Uint8Array(8)], 'stuff.zip', { type: 'application/zip' });
    const paste = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { files: [photo, archive] },
    });
    await act(async () => {
      host.querySelector('textarea')!.dispatchEvent(paste);
    });
    expect(host.querySelector('.gc-attachments')!.textContent).toContain('cat.png');
    expect(host.querySelector('[role=alert]')!.textContent).toContain('stuff.zip');
    expect(button('Send')!.disabled).toBe(false);

    await act(async () => button('Send')!.click());
    await tick();
    await tick();
    expect(host.querySelector('.gc-attachments.gc-sent')).not.toBeNull();
    expect(host.querySelector('.gc-prompt')).toBeNull();
    expect(host.textContent).toContain('A cat on a sofa.');
    expect(model.calls[0].media).toEqual([{ type: 'image', value: photo }]);
    expect(host.querySelector('.gc-composer .gc-attachments')).toBeNull();
  });

  it('matches files the way <input accept> does', () => {
    const accept = 'image/*, .md,application/json';
    expect(matchesAccept({ name: 'a.PNG', type: 'image/png' }, accept)).toBe(true);
    expect(matchesAccept({ name: 'README.MD', type: '' }, accept)).toBe(true);
    expect(matchesAccept({ name: 'x', type: 'application/json; charset=utf-8' }, accept)).toBe(true);
    expect(matchesAccept({ name: 'a.zip', type: 'application/zip' }, accept)).toBe(false);
    expect(matchesAccept({ name: 'a.zip', type: 'application/zip' }, undefined)).toBe(true);
  });
});

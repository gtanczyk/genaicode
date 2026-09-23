import { describe, expect, it } from 'vitest';
import { approximateSize, EventQueue } from './event-queue.js';

const limits = { unreadItems: 100, unreadBytes: 10, highWaterBytes: 10, lowWaterBytes: 4 };

async function take<T>(iterator: AsyncGenerator<T>, count: number) {
  const items: T[] = [];
  for (let i = 0; i < count; i++) items.push((await iterator.next()).value as T);
  return items;
}

describe('EventQueue', () => {
  it('keeps only the newest unread items within the byte budget', async () => {
    const queue = new EventQueue<string>((item) => item.length, limits);
    ['aaaa', 'bbbb', 'cccc', 'dddddddddddddddd'].forEach((item) => queue.push(item));
    queue.close();
    const items: string[] = [];
    for await (const item of queue.iterate()) items.push(item);
    expect(items).toEqual(['dddddddddddddddd']);
  });

  it('pauses the producer past the high-water mark and resumes it once drained', async () => {
    const queue = new EventQueue<string>((item) => item.length, limits);
    const pressure: boolean[] = [];
    queue.onPressure = (paused) => pressure.push(paused);
    const iterator = queue.iterate();
    const first = iterator.next();
    ['aaaa', 'bbbb', 'cccc', 'dddd'].forEach((item) => queue.push(item));
    expect(await first).toEqual({ value: 'aaaa', done: false });
    expect(pressure).toEqual([true]);
    let roomy = false;
    const room = queue.room().then(() => (roomy = true));

    await take(iterator, 1);
    expect(pressure).toEqual([true]);
    expect(roomy).toBe(false);
    await take(iterator, 1);
    await room;
    expect(pressure).toEqual([true, false]);
    expect(queue.bufferedBytes).toBe(4);
  });

  it('releases the producer and discards events when the consumer stops early', async () => {
    const queue = new EventQueue<string>((item) => item.length, limits);
    const pressure: boolean[] = [];
    queue.onPressure = (paused) => pressure.push(paused);
    const iterator = queue.iterate();
    const first = iterator.next();
    ['aaaaaaaaaaaa', 'bbbb'].forEach((item) => queue.push(item));
    await first;
    await iterator.return(undefined);
    expect(pressure).toEqual([true, false]);
    queue.push('cccc');
    expect(queue.bufferedBytes).toBe(0);
    await expect(queue.room()).resolves.toBeUndefined();
  });

  it('estimates sizes from strings', () => {
    expect(approximateSize('x'.repeat(100))).toBe(100);
    expect(approximateSize({ type: 'raw', line: 'x'.repeat(1000) })).toBeGreaterThan(1000);
  });
});

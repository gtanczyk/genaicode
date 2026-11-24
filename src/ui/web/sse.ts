/** One server-sent event: its name (`message` when unnamed) and its data lines joined. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Takes the complete events off the front of `buffer`, leaving an incomplete one in `rest`.
 * Of the `view` events among them only the newest is kept, in its place: each view replaces the
 * one before, and parsing and rendering the others would only delay the newest.
 */
export function takeEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  let rest = buffer;
  for (let sep = rest.indexOf('\n\n'); sep !== -1; sep = rest.indexOf('\n\n')) {
    const block = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  const newestView = events.findLastIndex((one) => one.event === 'view');
  return { events: events.filter((one, i) => one.event !== 'view' || i === newestView), rest };
}

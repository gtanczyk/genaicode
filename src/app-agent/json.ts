/**
 * JSON that never throws: a custom agent's tool input can hold a BigInt (sent as a string) or a
 * cycle (sent as `"[Circular]"`), or a `toJSON` or getter that throws (that object is copied field by
 * field, and what cannot be read becomes `"[Unreadable]"`). An object reached twice without a cycle is
 * written out each time.
 */
export function safeJson(value: unknown): string {
  try {
    return stringify(value);
  } catch {
    // A `toJSON` or getter that throws runs before any replacer sees the value.
    return stringify(plain(value, []));
  }
}

function stringify(value: unknown): string {
  const path: object[] = [];
  return (
    JSON.stringify(value, function (this: unknown, _key, item: unknown) {
      if (typeof item === 'bigint') return String(item);
      if (typeof item !== 'object' || item === null) return item;
      // `this` is the object holding `item`: drop the ancestors that are not on its path.
      while (path.length && path.at(-1) !== this) path.pop();
      if (path.includes(item)) return '[Circular]';
      path.push(item);
      return item;
    }) ?? ''
  );
}

// A copy made of plain data only: what cannot be read becomes `"[Unreadable]"`.
function plain(value: unknown, path: object[]): unknown {
  if (typeof value === 'bigint') return String(value);
  // A function (a `toJSON` among them) is left out, as JSON leaves it out.
  if (typeof value === 'function') return undefined;
  if (typeof value !== 'object' || value === null) return value;
  if (path.includes(value)) return '[Circular]';
  const inner = [...path, value];
  try {
    if (Array.isArray(value)) return value.map((item) => plain(item, inner));
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      try {
        copy[key] = plain((value as Record<string, unknown>)[key], inner);
      } catch {
        copy[key] = '[Unreadable]';
      }
    }
    return copy;
  } catch {
    return '[Unreadable]';
  }
}

/**
 * JSON that never throws: a custom agent's tool input can hold a BigInt (sent as a string) or a
 * cycle (sent as `"[Circular]"`). An object reached twice without a cycle is written out each time.
 */
export function safeJson(value: unknown): string {
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

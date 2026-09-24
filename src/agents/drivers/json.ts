export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringField(value: unknown, key: string): string | undefined {
  if (!isObject(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

export function numberField(value: unknown, key: string): number | undefined {
  if (!isObject(value)) return undefined;
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

/** Keep the prompt positional even when it starts with a dash. */
export function positionalPrompt(prompt: string): string[] {
  return prompt.startsWith('-') ? ['--', prompt] : [prompt];
}

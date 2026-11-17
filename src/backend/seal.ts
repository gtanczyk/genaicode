// Encrypted, authenticated tokens (AES-256-GCM over WebCrypto): the page keeps the
// conversation but can neither read nor change it. Runs on Node 20+, Workers, Deno, Bun.

const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Sealer {
  seal(value: unknown): Promise<string>;
  /** The value, or undefined when the token was not made with this secret or was changed. */
  open<T>(token: string): Promise<T | undefined>;
}

export function sealer(secret: string): Sealer {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('createAgentBackend: `secret` must be at least 32 characters.');
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('createAgentBackend needs WebCrypto (globalThis.crypto.subtle).');
  const key = subtle
    .digest('SHA-256', encoder.encode(`genaicode/backend state\0${secret}`))
    .then((raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));

  return {
    async seal(value) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const sealed = await subtle.encrypt({ name: 'AES-GCM', iv }, await key, encoder.encode(JSON.stringify(value)));
      const out = new Uint8Array(IV_BYTES + sealed.byteLength);
      out.set(iv);
      out.set(new Uint8Array(sealed), IV_BYTES);
      return toBase64Url(out);
    },
    async open<T>(token: string): Promise<T | undefined> {
      const bytes = fromBase64Url(token);
      if (!bytes || bytes.length <= IV_BYTES) return undefined;
      try {
        const plain = await subtle.decrypt(
          { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) },
          await key,
          bytes.slice(IV_BYTES),
        );
        return JSON.parse(decoder.decode(plain)) as T;
      } catch {
        return undefined;
      }
    },
  };
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | undefined {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

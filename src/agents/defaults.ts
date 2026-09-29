import { antigravity } from './drivers/antigravity.js';
import { claude } from './drivers/claude.js';
import { codex } from './drivers/codex.js';
import { copilot } from './drivers/copilot.js';
import { cursor } from './drivers/cursor.js';
import { gemini } from './drivers/gemini.js';
import { muse } from './drivers/muse.js';
import { opencode } from './drivers/opencode.js';
import { vibe } from './drivers/vibe.js';
import type { CodingAgent } from './types.js';

/**
 * Headless drivers the CLI and the Vite plugin offer, in the order `run` picks the first
 * installed one. Live drivers are left out: `genaicode run` has no approval prompt, so they
 * would deny everything.
 */
export function defaultAgents(): CodingAgent[] {
  return [claude(), codex(), copilot(), cursor(), gemini(), opencode(), vibe(), antigravity(), muse()];
}

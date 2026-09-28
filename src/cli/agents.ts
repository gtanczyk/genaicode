import { antigravity } from '../agents/drivers/antigravity.js';
import { claude } from '../agents/drivers/claude.js';
import { codex } from '../agents/drivers/codex.js';
import { copilot } from '../agents/drivers/copilot.js';
import { cursor } from '../agents/drivers/cursor.js';
import { gemini } from '../agents/drivers/gemini.js';
import { muse } from '../agents/drivers/muse.js';
import { opencode } from '../agents/drivers/opencode.js';
import { vibe } from '../agents/drivers/vibe.js';
import type { CodingAgent } from '../agents/types.js';

/**
 * Headless drivers the CLI can run, in the order `run` picks the first installed one.
 * Live drivers are left out: the CLI has no approval prompt, so they would deny everything.
 */
export function defaultAgents(): CodingAgent[] {
  return [claude(), codex(), copilot(), cursor(), gemini(), opencode(), vibe(), antigravity(), muse()];
}

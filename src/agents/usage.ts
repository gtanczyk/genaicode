// No Node imports: the browser bundle (genaicode/react) reaches this through failover.ts.
import type { AgentBudget } from './types.js';
import type { TokenUsage } from '../core/types.js';

/** Tokens a usage report counts: `totalTokens`, else input + output. */
export function tokenCount(usage: TokenUsage): number {
  return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/** Two usage reports added up. A report without `totalTokens` counts input + output. */
export function addUsage(total: TokenUsage, usage: TokenUsage): TokenUsage {
  const sum = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  const next: TokenUsage = {};
  const inputTokens = sum(total.inputTokens, usage.inputTokens);
  const outputTokens = sum(total.outputTokens, usage.outputTokens);
  const cachedInputTokens = sum(total.cachedInputTokens, usage.cachedInputTokens);
  // A turn without `totalTokens` counts input + output, so mixed agents add up right.
  const totalTokens =
    total.totalTokens === undefined && usage.totalTokens === undefined
      ? undefined
      : tokenCount(total) + tokenCount(usage);
  if (inputTokens !== undefined) next.inputTokens = inputTokens;
  if (outputTokens !== undefined) next.outputTokens = outputTokens;
  if (cachedInputTokens !== undefined) next.cachedInputTokens = cachedInputTokens;
  if (totalTokens !== undefined) next.totalTokens = totalTokens;
  return next;
}

/** What a session budget leaves for the next turn, or why nothing is left. */
export function remainingBudget(
  budget: AgentBudget | undefined,
  usage: TokenUsage,
  costUsd: number | undefined,
): { budget?: AgentBudget; spent?: string } | undefined {
  if (!budget || (budget.maxTokens === undefined && budget.maxCostUsd === undefined)) return undefined;
  const tokens = tokenCount(usage);
  if (budget.maxTokens !== undefined && tokens >= budget.maxTokens)
    return { spent: `The session used its token budget (${tokens} of ${budget.maxTokens}).` };
  if (budget.maxCostUsd !== undefined && (costUsd ?? 0) >= budget.maxCostUsd)
    return { spent: `The session used its cost budget ($${(costUsd ?? 0).toFixed(4)} of $${budget.maxCostUsd}).` };
  return {
    budget: {
      ...(budget.maxTokens !== undefined ? { maxTokens: budget.maxTokens - tokens } : {}),
      ...(budget.maxCostUsd !== undefined ? { maxCostUsd: budget.maxCostUsd - (costUsd ?? 0) } : {}),
      // Warnings belong to the whole session (`budgetStatus`), not to what one turn has left.
      warnAt: Infinity,
    },
  };
}

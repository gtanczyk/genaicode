type CostTuple = {
  timestamp: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
};

const tuples: CostTuple[] = [];

export function collectCost(cost: number, inutTokens: number, outputTokens: number) {
  tuples.push({
    timestamp: Date.now(),
    cost: cost,
    inputTokens: inutTokens,
    outputTokens: outputTokens,
  });
}

export function getCollectedCosts() {
  return tuples;
}

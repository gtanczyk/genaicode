type CostTuple = {
  timestamp: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cheap: boolean;
};

const tuples: CostTuple[] = [];

export function collectCost(cost: number, inputTokens: number, outputTokens: number, cheap: boolean = false) {
  const adjustedCost = cheap ? cost / 10 : cost;
  tuples.push({
    timestamp: Date.now(),
    cost: adjustedCost,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    cheap: cheap,
  });
}

export function getCollectedCosts() {
  return tuples;
}

export function getTotalCost(): number {
  return tuples.reduce((total, item) => total + item.cost, 0);
}

export function getTotalTokens(): { input: number; output: number } {
  return tuples.reduce(
    (total, item) => ({
      input: total.input + item.inputTokens,
      output: total.output + item.outputTokens,
    }),
    { input: 0, output: 0 },
  );
}

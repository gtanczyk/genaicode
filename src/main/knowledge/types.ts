export interface KBEntry {
  id: string;
  createdAt: string;
  prompt: string;
  answer: string;
  metadata?: Record<string, unknown>;
}

export type GainKnowledgeArgs = {
  prompt: string;
  answer: string;
  metadata?: Record<string, unknown>;
};

export type QueryKnowledgeArgs = {
  query: string;
  explanation: string;
};

export interface QueryResult {
  synthesizedResponse?: string;
  sourceEntries?: KBEntry[];
}

export enum StepResult {
  CONTINUE,
  BREAK,
}

export interface SummaryInfo {
  path: string;
  summary: string;
}

export type SummaryCache = Record<
  string,
  {
    summary: string;
    checksum: string;
  }
>;

export interface SummarizationResult {
  summaries: SummaryInfo[];
  tokenCount: number;
}

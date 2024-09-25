export enum StepResult {
  CONTINUE,
  BREAK,
}

export interface SummaryInfo {
  path: string;
  tokenCount: number;
  summary: string;
}

export type SummaryCache = Record<
  string,
  {
    tokenCount: number;
    summary: string;
    checksum: string;
  }
> & { _version: string };

export interface SummarizationResult {
  summaries: SummaryInfo[];
  tokenCount: number;
}

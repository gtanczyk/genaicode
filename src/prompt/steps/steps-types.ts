import { DependencyInfo } from '../../files/read-files';

export enum StepResult {
  CONTINUE,
  BREAK,
}

export interface SummaryInfo {
  filePath: string;
  tokenCount: number;
  summary: string;
}

export type SummaryCache = Record<
  string,
  {
    tokenCount: number;
    summary: string;
    checksum: string;
    dependencies: DependencyInfo[];
  }
> & { _version: string };

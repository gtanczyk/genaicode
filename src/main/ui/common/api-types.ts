import { AiServiceType } from '../../codegen-types.js';
import { UsageMetrics } from '../../common/cost-collector.js';

export type Usage = {
  usageMetrics: Record<AiServiceType | 'total', UsageMetrics>;
};

export interface CodegenResult {
  success: boolean;
  message?: string;
}

export type ConfirmationProps =
  | {
      includeAnswer: boolean;
      confirmLabel: string;
      declineLabel: string;
      defaultValue: boolean;
    }
  | undefined;

export interface Question {
  id: string;
  text: string;
  confirmation: ConfirmationProps;
}

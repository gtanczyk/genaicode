import { AiServiceType } from '../../../../codegen-types.js';
import { UsageMetrics } from '../../../../common/cost-collector.js';

export type Usage = {
  usageMetrics: Record<AiServiceType | 'total', UsageMetrics>;
};

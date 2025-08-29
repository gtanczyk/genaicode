import React from 'react';
import {
  PlanContent,
  StepElement,
  StepStatus,
  StepDescription,
} from './styles/execution-plan-visualiser-styles';
import { ExecutionPlan, ExecutionPlanStep, ExecutionPlanUpdate } from '../../../../common/api-types';

interface ExecutionPlanPanelProps {
  executionPlan: ExecutionPlan | undefined;
  planUpdates: ExecutionPlanUpdate[];
}

export const ExecutionPlanPanel: React.FC<ExecutionPlanPanelProps> = ({ executionPlan, planUpdates }) => {
  if (!executionPlan || !executionPlan.length) {
    return <PlanContent>No execution plan available.</PlanContent>;
  }

  // Create a mutable copy to apply updates without modifying the original prop
  const displayPlan: ExecutionPlan = JSON.parse(JSON.stringify(executionPlan));

  for (const update of planUpdates) {
    const step = displayPlan.find((s) => s.id === update.id);
    if (step) {
      step.statusUpdate = update.statusUpdate;
      step.state = update.state;
    }
  }

  return (
    <PlanContent>
      {displayPlan.map((step: ExecutionPlanStep) => (
        <StepElement key={step.id} state={step.state ?? 'pending'}>
          <StepStatus state={step.state ?? 'pending'}>{step.state ?? 'pending'}</StepStatus>
          <StepDescription>
            <strong>ID: {step.id}</strong>
            <p>{step.description}</p>
            {step.statusUpdate && <small>Update: {step.statusUpdate}</small>}
          </StepDescription>
        </StepElement>
      ))}
    </PlanContent>
  );
};

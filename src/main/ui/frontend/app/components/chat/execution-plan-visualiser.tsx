import React from 'react';
import { useChatState } from '../../contexts/chat-state-context';
import {
  VisualiserContainer,
  VisualiserHeader,
  CloseButton,
  PlanContent,
  StepElement,
  StepStatus,
  StepDescription,
} from './styles/execution-plan-visualiser-styles';
import { ExecutionPlan, ExecutionPlanStep, ExecutionPlanUpdate } from '../../../../common/api-types';

export const ExecutionPlanVisualiser: React.FC<{ iterationId: string | null }> = ({ iterationId }) => {
  const { terminalEvents, isExecutionPlanVisualiserOpen, toggleExecutionPlanVisualiser } = useChatState();

  const executionPlanEvent = terminalEvents[iterationId || '']?.filter((event) => event.data?.plan).reverse()[0];

  const executionPlan: ExecutionPlan | undefined = executionPlanEvent?.data?.plan as ExecutionPlan | undefined;

  if (!isExecutionPlanVisualiserOpen || !executionPlan?.length) {
    return null;
  }

  const planUpdates: ExecutionPlanUpdate[] =
    (
      terminalEvents[iterationId || '']?.filter(
        (event) => event.data?.statusUpdate && event.data?.id && event.data?.state,
      ) || []
    ).map((event) => event.data as ExecutionPlanUpdate) || [];

  for (const update of planUpdates) {
    const step = executionPlan.find((step) => step.id === update.id);
    if (step) {
      step.statusUpdate = update.statusUpdate;
      step.state = update.state;
    }
  }

  return (
    <VisualiserContainer>
      <VisualiserHeader>
        <h3>Execution Plan</h3>
        <CloseButton onClick={toggleExecutionPlanVisualiser} aria-label="Close execution plan visualiser">
          &times;
        </CloseButton>
      </VisualiserHeader>
      <PlanContent>
        {executionPlan.map((step: ExecutionPlanStep) => (
          <StepElement key={step.id} state={step.state}>
            <StepStatus state={step.state}>{step.state}</StepStatus>
            <StepDescription>
              <strong>ID: {step.id}</strong>
              <p>{step.description}</p>
              {step.statusUpdate && <small>Update: {step.statusUpdate}</small>}
            </StepDescription>
          </StepElement>
        ))}
      </PlanContent>
    </VisualiserContainer>
  );
};

import React from 'react';
import styled from 'styled-components';

// Styled Components
const ViewContainer = styled.div`
  background-color: ${(props) => props.theme.colors.codeBackground};
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  padding: 16px;
  margin: 8px 0;
  font-family: monospace;
  color: ${(props) => props.theme.colors.text};
`;

const Title = styled.h4`
  margin-top: 0;
  margin-bottom: 12px;
  color: ${(props) => props.theme.colors.text};
  font-size: 1.1em;
  font-weight: bold;
`;

const ActionList = styled.ul`
  list-style-type: none;
  padding-left: 0;
  margin-bottom: 0;
`;

const ActionItem = styled.li`
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid ${(props) => props.theme.colors.borderLight};
  border-radius: 3px;
  background-color: ${(props) => props.theme.colors.background};
  &:last-child {
    margin-bottom: 0;
  }
`;

const ActionHeader = styled.div`
  font-weight: bold;
  margin-bottom: 8px;
  color: ${(props) => props.theme.colors.primary};
  font-size: 1.05em;
`;

const ParamsList = styled.ul`
  list-style-type: none;
  padding-left: 16px;
  margin-top: 6px;
  margin-bottom: 0;
`;

const ParamItem = styled.li`
  margin-bottom: 4px;
  font-size: 0.9em;
  word-break: break-all;

  &:last-child {
    margin-bottom: 0;
  }
`;

const ParamName = styled.span`
  font-weight: bold;
  color: ${(props) => props.theme.colors.textEmphasis};
`;

const ParamValue = styled.span`
  color: ${(props) => props.theme.colors.textSecondary};
  white-space: pre-wrap;
`;

// Interfaces
export interface CompoundActionParam {
  paramName: string;
  paramValue: string;
}

export interface CompoundActionItem {
  actionName: string;
  params: CompoundActionParam[];
}

export interface CompoundActionData {
  actions: CompoundActionItem[];
}

export interface CompoundActionViewProps extends CompoundActionData {
  title?: string;
}

export const isCompoundActionData = (data: unknown): data is CompoundActionData => {
  return (
    data !== null &&
    typeof data === 'object' &&
    'actions' in data &&
    Array.isArray((data as CompoundActionData).actions) &&
    (data as CompoundActionData).actions.every(
      (action) =>
        action &&
        typeof action.actionName === 'string' &&
        Array.isArray(action.params) &&
        action.params.every(
          (param) => param && typeof param.paramName === 'string' && typeof param.paramValue !== 'undefined',
        ),
    )
  );
};

export const CompoundActionView: React.FC<CompoundActionViewProps> = ({ actions, title = 'Proposed Actions' }) => {
  if (!actions || actions.length === 0) {
    return (
      <ViewContainer>
        <Title>{title}</Title>
        <p>No actions were proposed.</p>
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <Title>{title}</Title>
      <ActionList>
        {actions.map((action, index) => (
          <ActionItem key={`${action.actionName}-${index}`}>
            <ActionHeader>{action.actionName}</ActionHeader>
            {action.params && action.params.length > 0 && (
              <ParamsList>
                {action.params.map((param, paramIndex) => (
                  <ParamItem key={`${param.paramName}-${paramIndex}`}>
                    <ParamName>{param.paramName}: </ParamName>
                    <ParamValue>"{String(param.paramValue)}"</ParamValue>
                  </ParamItem>
                ))}
              </ParamsList>
            )}
          </ActionItem>
        ))}
      </ActionList>
    </ViewContainer>
  );
};

import React from 'react';
import styled from 'styled-components';
import { PromptHistoryItem } from '../api/api-client';

interface PromptHistoryProps {
  onReRun: (prompt: string) => void;
  promptHistory: PromptHistoryItem[];
  totalCost: number;
}

const HistoryContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
`;

const HistoryTitle = styled.h2`
  color: ${({ theme }) => theme.colors.primary};
  margin-bottom: 15px;
`;

const HistoryList = styled.ul`
  list-style-type: none;
  padding: 0;
  margin: 0;
`;

const HistoryItem = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const PromptText = styled.span`
  color: ${({ theme }) => theme.colors.text};
  flex-grow: 1;
  margin-right: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CostText = styled.span`
  color: ${({ theme }) => theme.colors.secondary};
  margin-right: 10px;
`;

const ReRunButton = styled.button`
  background-color: ${({ theme }) => theme.colors.buttonBg};
  color: ${({ theme }) => theme.colors.buttonText};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.3s ease;

  &:hover {
    background-color: ${({ theme }) => theme.colors.buttonHoverBg};
  }
`;

const NoHistoryMessage = styled.p`
  color: ${({ theme }) => theme.colors.secondary};
  font-style: italic;
  text-align: center;
`;

const TotalCostContainer = styled.div`
  margin-top: 15px;
  text-align: right;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.primary};
`;

const PromptHistory: React.FC<PromptHistoryProps> = ({ onReRun, promptHistory, totalCost }) => {
  return (
    <HistoryContainer>
      <HistoryTitle>Prompt History</HistoryTitle>
      {promptHistory.length === 0 ? (
        <NoHistoryMessage>No prompts in history</NoHistoryMessage>
      ) : (
        <>
          <HistoryList>
            {promptHistory.map((item, index) => (
              <HistoryItem key={index}>
                <PromptText>{item.prompt}</PromptText>
                <CostText>${item.cost.toFixed(4)}</CostText>
                <ReRunButton onClick={() => onReRun(item.prompt)}>
                  Re-run
                </ReRunButton>
              </HistoryItem>
            ))}
          </HistoryList>
          <TotalCostContainer>
            Total Cost: ${totalCost.toFixed(4)}
          </TotalCostContainer>
        </>
      )}
    </HistoryContainer>
  );
};

export default PromptHistory;
import React from 'react';
import styled from 'styled-components';

interface CostDisplayProps {
  totalCost: number;
}

export const CostDisplay: React.FC<CostDisplayProps> = ({ totalCost }) => {
  return (
    <CostContainer>
      <CostText>Total Cost: ${totalCost.toFixed(2)}</CostText>
    </CostContainer>
  );
};

const CostContainer = styled.div`
  display: flex;
  align-items: center;
  margin-right: 10px;
`;

const CostText = styled.span`
  font-size: 0.9em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
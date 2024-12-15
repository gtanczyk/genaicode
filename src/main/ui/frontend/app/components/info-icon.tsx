import 'react';
import styled from 'styled-components';
import { dispatchRcConfigModalOpen } from './rc-config-modal.js';

export const InfoIcon = () => {
  return (
    <IconWrapper onClick={dispatchRcConfigModalOpen}>
      <Icon aria-label="Show RC configuration">ℹ️</Icon>
    </IconWrapper>
  );
};

const IconWrapper = styled.div`
  display: inline-block;
  cursor: pointer;
`;

const Icon = styled.span`
  font-size: 24px;
  color: ${(props) => props.theme.colors.primary};
`;

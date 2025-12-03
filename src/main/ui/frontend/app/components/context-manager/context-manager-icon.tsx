import styled from 'styled-components';

const IconWrapper = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

export const ContextManagerIcon = () => {
  return (
    <IconWrapper>
      <span role="img" aria-label="Context Manager">
        📂
      </span>
    </IconWrapper>
  );
};

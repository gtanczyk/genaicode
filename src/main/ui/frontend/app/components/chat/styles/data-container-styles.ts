import styled from 'styled-components';

export const DataContainer = styled.pre`
  margin-top: 8px;
  padding: 8px;
  background-color: ${(props) => props.theme.colors.codeBackground};
  border-radius: 4px;
  font-size: 0.9em;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;

  .w-json-view-container {
    background: none !important;
  }
`;

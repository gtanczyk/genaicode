import React from 'react';
import JsonView from '@uiw/react-json-view';
import { DataContainer as StyledDataContainer } from './styles/data-container-styles.js';

interface DataContainerProps {
  data: unknown;
}

export const DataContainer: React.FC<DataContainerProps> = ({ data }) => {
  return (
    <StyledDataContainer>
      {typeof data === 'object' ? <JsonView value={data as object} /> : JSON.stringify(data, null, 2)}
    </StyledDataContainer>
  );
};

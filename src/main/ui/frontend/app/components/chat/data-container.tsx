import React from 'react';
import { DataContainer as StyledDataContainer } from './styles/data-container-styles';

interface DataContainerProps {
  data: unknown;
}

export const DataContainer: React.FC<DataContainerProps> = ({ data }) => {
  const renderData = (data: unknown) => {
    return JSON.stringify(data, null, 2);
  };

  return <StyledDataContainer>{renderData(data)}</StyledDataContainer>;
};

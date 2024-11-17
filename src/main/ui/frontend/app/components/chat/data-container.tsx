import React from 'react';
import { useTheme } from 'styled-components';
import JsonView from '@uiw/react-json-view';
import { darkTheme } from '@uiw/react-json-view/dark';
import { lightTheme } from '@uiw/react-json-view/light';
import { DataContainer as StyledDataContainer } from './styles/data-container-styles.js';

interface DataContainerProps {
  data: unknown;
}

export const DataContainer: React.FC<DataContainerProps> = ({ data }) => {
  const theme = useTheme();

  return (
    <StyledDataContainer>
      {typeof data === 'object' ? (
        <JsonView
          value={data as object}
          shortenTextAfterLength={0}
          style={theme.name === 'dark' ? darkTheme : lightTheme}
        />
      ) : (
        JSON.stringify(data, null, 2)
      )}
    </StyledDataContainer>
  );
};

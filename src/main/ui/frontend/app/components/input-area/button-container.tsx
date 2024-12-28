import React from 'react';
import styled from 'styled-components';
import { AiServiceSelector } from './ai-service-selector';
import { AiServiceType, CodegenOptions } from '../../../../../codegen-types';

interface ButtonContainerProps {
  onSubmit: () => void;
  onUploadClick: () => void;
  onAiServiceChange: (aiService: AiServiceType) => void;
  options: CodegenOptions;
  disabled: boolean;
}

export const ButtonContainer: React.FC<ButtonContainerProps> = ({
  onSubmit,
  onUploadClick,
  onAiServiceChange,
  options,
  disabled,
}) => {
  return (
    <ButtonContainerWrapper>
      <SubmitButton onClick={onSubmit} disabled={disabled}>
        Submit
      </SubmitButton>
      <Button onClick={onUploadClick}>Upload Images</Button>
      <AiServiceSelector value={options.aiService} onChange={onAiServiceChange} />
    </ButtonContainerWrapper>
  );
};

const Button = styled.button`
  color: ${({ theme }) => theme.colors.buttonText};
  background-color: ${({ theme }) => theme.colors.buttonBg};
  border: none;
  border-radius: 4px;
  padding: 10px 15px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s ease;
  margin-right: 10px;

  &:hover {
    background-color: ${({ theme }) => theme.colors.buttonHoverBg};
  }

  &:disabled {
    background-color: ${({ theme }) => theme.colors.disabled};
    cursor: not-allowed;
  }
`;

const SubmitButton = styled(Button)`
  background-color: ${({ theme }) => theme.colors.primary};
  color: #ffffff;

  &:hover {
    background-color: ${({ theme }) => theme.colors.primaryHover};
  }

  &:disabled {
    background-color: ${({ theme }) => theme.colors.disabled};
  }
`;

const ButtonContainerWrapper = styled.div`
  display: flex;
  justify-content: flex-start;
  margin-top: 10px;
`;

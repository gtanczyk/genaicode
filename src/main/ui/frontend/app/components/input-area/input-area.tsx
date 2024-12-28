import React, { useState, useRef } from 'react';
import styled from 'styled-components';
import { CodegenOptions } from '../../../../../codegen-types.js';
import { StyledTextarea } from '../styled-textarea';
import { ImageUpload } from './image-upload';
import { ButtonContainer } from './button-container';

interface InputAreaProps {
  onSubmit: (input: string, images: File[]) => void;
  isExecuting: boolean;
  onInterrupt: () => void;
  codegenOptions: CodegenOptions;
  onOptionsChange: (newOptions: CodegenOptions) => void;
}

export const InputArea: React.FC<InputAreaProps> = ({ onSubmit, isExecuting, codegenOptions, onOptionsChange }) => {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (isExecuting) {
    return null;
  }

  const handleSubmit = () => {
    if (input.trim() || images.length > 0) {
      onSubmit(input.trim(), images);
      setInput('');
      setImages([]);
    }
  };

  const handleImageUpload = (newImages: File[]) => {
    setImages(newImages);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleImagePaste = (file: File) => {
    const newImages = [...images, file];
    handleImageUpload(newImages);
  };

  const handleAiServiceChange = (aiService: CodegenOptions['aiService']) => {
    onOptionsChange({
      ...codegenOptions,
      aiService,
    });
  };

  return (
    <InputContainer>
      <TextareaContainer>
        <StyledTextarea
          value={input}
          onChange={setInput}
          placeholder="Enter your input here"
          onImagePaste={handleImagePaste}
        />
      </TextareaContainer>
      <ImageUpload
        images={images}
        onImagesChange={handleImageUpload}
        error={error}
        setError={setError}
        fileInputRef={fileInputRef}
      />
      <ButtonContainer
        onSubmit={handleSubmit}
        onUploadClick={handleUploadClick}
        onAiServiceChange={handleAiServiceChange}
        options={codegenOptions}
        disabled={!input.trim() && images.length === 0}
      />
    </InputContainer>
  );
};

const InputContainer = styled.div`
  display: flex;
  flex-direction: column;
  background-color: ${(props) => props.theme.colors.background};
  border-top: 1px solid ${(props) => props.theme.colors.border};
  padding: 16px;
  width: 100%;
  box-sizing: border-box;
`;

const TextareaContainer = styled.div`
  margin-bottom: 16px;
  width: 100%;
`;

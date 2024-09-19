import React, { useState } from 'react';
import styled from 'styled-components';
import { CodegenOptions } from '../../../../../codegen-types.js';
import { TextInput } from './text-input';
import { ImageUpload } from './image-upload';
import { ButtonContainer } from './button-container';
import { CodegenOptionsForm } from './codegen-options-form';

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
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const toggleOptions = () => {
    setShowOptions(!showOptions);
  };

  return (
    <InputContainer>
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onImagePaste={(file) => setImages([...images, file])}
      />
      <ImageUpload images={images} onImagesChange={handleImageUpload} error={error} setError={setError} />
      <ButtonContainer
        onSubmit={handleSubmit}
        onToggleOptions={toggleOptions}
        onUploadClick={() => {}} // This is a placeholder, consider implementing actual upload functionality
        disabled={!input.trim() && images.length === 0}
      />
      {showOptions && (
        <CodegenOptionsForm options={codegenOptions} onOptionsChange={onOptionsChange} disabled={false} />
      )}
    </InputContainer>
  );
};

const InputContainer = styled.div`
  display: flex;
  flex-direction: column;
  background-color: ${(props) => props.theme.colors.background};
  border-top: 1px solid ${(props) => props.theme.colors.border};
  padding: 16px;
`;

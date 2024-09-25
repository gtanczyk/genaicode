import React from 'react';
import { StyledTextarea } from '../styled-textarea';

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onImagePaste: (file: File) => void;
}

export const TextInput: React.FC<TextInputProps> = ({ value, onChange, onSubmit, onImagePaste }) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const blob = items[i].getAsFile();
          if (blob) {
            const file = new File([blob], `pasted-image-${Date.now()}.png`, { type: 'image/png' });
            onImagePaste(file);
          }
          break;
        }
      }
    }
  };

  return (
    <StyledTextarea
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={'Enter your codegen prompt here or paste an image...'}
      maxHeight="50vh"
    />
  );
};
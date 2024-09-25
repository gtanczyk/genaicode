import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';

interface StyledTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onImagePaste?: (file: File) => void;
  maxViewportHeight?: number;
  placeholder?: string;
}

const TextareaWrapper = styled.div`
  position: relative;
  width: 100%;
`;

const Textarea = styled.textarea`
  width: 100%;
  min-height: 60px;
  resize: none;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  font-family: inherit;
  font-size: 14px;
  background-color: ${(props) => props.theme.colors.inputBg};
  color: ${(props) => props.theme.colors.inputText};
  box-sizing: border-box;
  overflow: hidden;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.colors.primary};
  }
`;

export const StyledTextarea: React.FC<StyledTextareaProps> = ({
  value,
  onChange,
  onKeyDown,
  onPaste,
  onImagePaste,
  maxViewportHeight = 0.5,
  ...props
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeightPx = maxViewportHeight * window.innerHeight;
      const newHeight = Math.min(scrollHeight, maxHeightPx);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value, maxViewportHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
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
            onImagePaste?.(file);
          }
          break;
        }
      }
    }
    onPaste?.(e);
  };

  return (
    <TextareaWrapper>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        {...props}
      />
    </TextareaWrapper>
  );
};
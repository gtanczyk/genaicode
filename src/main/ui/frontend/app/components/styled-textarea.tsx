import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';

interface StyledTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onChange: (value: string) => void;
  maxHeight?: string;
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
  maxHeight = '50vh',
  ...props
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeightPx = parseInt(maxHeight);
      const newHeight = Math.min(scrollHeight, maxHeightPx);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value, maxHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  return (
    <TextareaWrapper>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        {...props}
      />
    </TextareaWrapper>
  );
};
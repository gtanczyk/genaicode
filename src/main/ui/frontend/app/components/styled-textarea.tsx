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
  /* Allow vertical scrolling when content exceeds max height, keep horizontal hidden */
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

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

  // Recompute height and overflow based on content and viewport
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const recompute = () => {
      // Reset height to measure natural content size
      el.style.height = 'auto';
      const scrollHeight = el.scrollHeight;
      const maxHeightPx = maxViewportHeight * window.innerHeight;
      const newHeight = Math.min(scrollHeight, maxHeightPx);
      el.style.height = `${newHeight}px`;
      // Toggle overflowY based on whether content exceeds max height
      el.style.overflowY = scrollHeight <= maxHeightPx ? 'hidden' : 'auto';
    };

    // Initial compute on mount/update
    recompute();

    // Recompute on resize
    const handleResize = () => recompute();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
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
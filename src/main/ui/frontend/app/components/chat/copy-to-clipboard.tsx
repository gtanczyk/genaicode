import React, { useState } from 'react';
import styled from 'styled-components';

interface CopyToClipboardProps {
  content: string;
}

export const CopyToClipboard: React.FC<CopyToClipboardProps> = ({ content }) => {
  const [copyStatus, setCopyStatus] = useState<'success' | 'error' | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus(null), 2000);
    } catch (error) {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus(null), 2000);
    }
  };

  return (
    <CopyButton onClick={handleCopy} status={copyStatus}>
      {copyStatus === null && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 4v8h8V4H4zm1 1h6v6H5V5z" />
          <path d="M3 3v9h9V3H3zm1 1h7v7H4V4z" />
        </svg>
      )}
      {copyStatus === 'success' && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
        </svg>
      )}
      {copyStatus === 'error' && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM6.5 11a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm.75-6.5h1.5v4.5h-1.5V4.5z" />
        </svg>
      )}
    </CopyButton>
  );
};

export const CopyButton = styled.button<{ status: 'success' | 'error' | null }>`
  padding: 4px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => {
    switch (props.status) {
      case 'success':
        return props.theme.colors.diffAdded;
      case 'error':
        return props.theme.colors.diffRemoved;
      default:
        return props.theme.colors.background;
    }
  }};
  color: ${(props) => {
    switch (props.status) {
      case 'success':
        return props.theme.colors.diffAddedText;
      case 'error':
        return props.theme.colors.diffRemovedText;
      default:
        return props.theme.colors.text;
    }
  }};
  cursor: pointer;
  transition: background-color 0.2s ease-in-out;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;

  &:hover {
    background-color: ${(props) => props.theme.colors.backgroundHover};
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

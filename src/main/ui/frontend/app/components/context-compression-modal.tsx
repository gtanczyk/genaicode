import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useChatState } from '../contexts/chat-state-context.js';
import { compressContext, getContextPreview } from '../api/api-client.js';

// Styled Components
const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContainer = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  border-radius: 8px;
  width: 90%;
  max-width: 800px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const ModalHeader = styled.div`
  padding: 16px 24px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  justify-content: space-between;
  align-items: center;

  h2 {
    margin: 0;
    font-size: 1.25rem;
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.text};
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const ModalContent = styled.div`
  padding: 24px;
  overflow-y: auto;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const ButtonGroup = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const Button = styled.button<{ variant?: 'primary' | 'secondary' | 'danger' }>`
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;

  ${({ variant, theme }) => {
    switch (variant) {
      case 'primary':
        return `
          background-color: ${theme.colors.primary};
          color: white;
          &:hover { background-color: ${theme.colors.primaryHover || theme.colors.primary}; opacity: 0.9; }
          &:disabled { background-color: ${theme.colors.border}; cursor: not-allowed; }
        `;
      case 'danger':
        return `
          background-color: ${theme.colors.error || '#dc3545'};
          color: white;
          &:hover { opacity: 0.9; }
        `;
      default:
        return `
          background-color: transparent;
          border-color: ${theme.colors.border};
          color: ${theme.colors.text};
          &:hover { background-color: ${theme.colors.backgroundAlt}; }
        `;
    }
  }}
`;

const PreviewSection = styled.div`
  background-color: ${({ theme }) => theme.colors.backgroundAlt};
  border-radius: 6px;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const PreviewTitle = styled.h3`
  margin: 0 0 12px 0;
  font-size: 1rem;
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;

  span.label {
    font-size: 0.8rem;
    color: ${({ theme }) => theme.colors.textSecondary || '#888'};
  }

  span.value {
    font-size: 1.1rem;
    font-weight: 600;
    color: ${({ theme }) => theme.colors.text};
  }
`;

const ItemList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 8px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: ${({ theme }) => theme.colors.background};
  }

  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 3px;
  }
`;

const PromptItemRow = styled.div<{ type: string }>`
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  background-color: ${({ theme }) => theme.colors.background};
  border-left: 3px solid
    ${({ type, theme }) =>
      type === 'systemPrompt'
        ? theme.colors.warning || '#f0ad4e'
        : type === 'user'
          ? theme.colors.success || '#5cb85c'
          : theme.colors.primary};
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: help;
  transition: background-color 0.2s;

  &:hover {
    background-color: ${({ theme }) => theme.colors.backgroundAlt};
  }
`;

const ItemHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
`;

const ItemType = styled.span`
  font-weight: 600;
  text-transform: capitalize;
  min-width: 100px;
`;

const ItemSize = styled.span`
  font-family: monospace;
  font-size: 0.8rem;
  opacity: 0.7;
  min-width: 60px;
  text-align: right;
`;

const ItemDesc = styled.div`
  font-size: 0.85rem;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
`;

const ProgressBar = styled.div<{ progress: number }>`
  height: 4px;
  background-color: ${({ theme }) => theme.colors.border};
  border-radius: 2px;
  overflow: hidden;
  margin-top: 20px;

  &::after {
    content: '';
    display: block;
    height: 100%;
    width: ${({ progress }) => progress}%;
    background-color: ${({ theme }) => theme.colors.primary};
    transition: width 0.3s ease;
  }
`;

const ResultMessage = styled.div<{ type: 'success' | 'error' }>`
  padding: 12px;
  border-radius: 4px;
  margin-top: 16px;
  background-color: ${({ type, theme }) =>
    type === 'success'
      ? theme.colors.successBg || 'rgba(92, 184, 92, 0.1)'
      : theme.colors.errorBg || 'rgba(220, 53, 69, 0.1)'};
  color: ${({ type, theme }) =>
    type === 'success' ? theme.colors.success || '#5cb85c' : theme.colors.error || '#dc3545'};
  border: 1px solid
    ${({ type, theme }) => (type === 'success' ? theme.colors.success || '#5cb85c' : theme.colors.error || '#dc3545')};
`;

interface ContextPreviewItem {
  type: string;
  summary: string;
  tokenCount: number;
}

export const ContextCompressionModal: React.FC = () => {
  const { isCompressionModalOpen, toggleCompressionModal } = useChatState();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [previewItems, setPreviewItems] = useState<ContextPreviewItem[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);

  const refreshPreview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getContextPreview();
      setPreviewItems(data.preview);
      setTotalTokens(data.totalTokens);
    } catch (error) {
      console.error('Failed to get context preview:', error);
      // Optional: show error in UI
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isCompressionModalOpen) {
      refreshPreview();
      setResult(null);
    }
  }, [isCompressionModalOpen, refreshPreview]);

  const handleCompress = async () => {
    setLoading(true);
    setResult(null);
    try {
      const response = await compressContext();
      setResult({
        success: true,
        message: `Compression successful! Reduced context by ${response.savedTokens || 'unknown'} tokens.`,
      });
      // Refresh preview after successful compression
      refreshPreview();
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Compression failed',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isCompressionModalOpen) return null;

  return (
    <ModalOverlay onClick={toggleCompressionModal}>
      <ModalContainer onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <h2>Context Compression Tool</h2>
          <CloseButton onClick={toggleCompressionModal}>&times;</CloseButton>
        </ModalHeader>

        <ModalContent>
          <p>
            This tool analyzes the current conversation context and compresses it to save tokens while preserving
            essential information. It will summarize past interactions and remove redundant data.
          </p>

          <PreviewSection>
            <PreviewTitle>
              Context Preview
              <span style={{ fontSize: '0.8rem', fontWeight: 'normal', opacity: 0.7 }}>(Actual breakdown)</span>
            </PreviewTitle>

            <StatGrid>
              <StatItem>
                <span className="label">Total Items</span>
                <span className="value">{previewItems.length}</span>
              </StatItem>
              <StatItem>
                <span className="label">Total Tokens</span>
                <span className="value">{totalTokens.toLocaleString()}</span>
              </StatItem>
            </StatGrid>

            <ItemList>
              {previewItems.map((item, index) => {
                return (
                  <PromptItemRow key={index} type={item.type} title={item.summary}>
                    <ItemHeader>
                      <ItemType>{item.type === 'systemPrompt' ? 'System' : item.type}</ItemType>
                      <ItemSize>{item.tokenCount}t</ItemSize>
                    </ItemHeader>
                    <ItemDesc>{item.summary}</ItemDesc>
                  </PromptItemRow>
                );
              })}
            </ItemList>
          </PreviewSection>

          {loading && <ProgressBar progress={100} className="animate-pulse" />}

          {result && <ResultMessage type={result.success ? 'success' : 'error'}>{result.message}</ResultMessage>}

          <ButtonGroup>
            <Button onClick={toggleCompressionModal} disabled={loading}>
              Close
            </Button>
            <Button variant="primary" onClick={handleCompress} disabled={loading}>
              {loading ? 'Compressing...' : 'Compress Context'}
            </Button>
          </ButtonGroup>
        </ModalContent>
      </ModalContainer>
    </ModalOverlay>
  );
};

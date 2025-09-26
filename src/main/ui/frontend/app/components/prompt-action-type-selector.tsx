import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { getActionTypeOptions } from '../api/api-client.js';
import { ActionType } from '../../../../../prompt/steps/step-ask-question/step-ask-question-types.js';

interface PromptActionTypeSelectorProps {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const humanReadableActionTypes: Record<ActionType, string> = {
  sendMessage: '✉️ Send Message',
  updateFile: '📝 Update File',
  createFile: '📄 Create File',
  confirmCodeGeneration: '🚀 Generate Code',
  runProjectCommand: '⚙️ Run Command',
  runBashCommand: '셸 Run Bash Command',
  searchCode: '🔍 Search Code',
  requestFilesContent: '📂 Request Files',
  endConversation: '👋 End Conversation',
  compoundAction: '🧱 Compound Action',
  runContainerTask: '🐳 Run Container Task',
  requestPermissions: '🔒 Request Permissions',
  performAnalysis: '🔬 Perform Analysis',
  contextOptimization: '✨ Optimize Context',
  reasoningInference: '🤔 Reasoning Inference',
  genaicodeHelp: '❓ GenAIcode Help',
  conversationGraph: '📊 Conversation Graph',
  generateImage: '🎨 Generate Image',
  readExternalFiles: '📖 Read External Files',
  exploreExternalDirectories: '🗺️ Explore External Dirs',
  removeFilesFromContext: '🗑️ Remove Files from Context',
  requestGitContext: '🐙 Request Git Context',
  webSearch: '🌐 Web Search',
  codeGeneration: '💻 Code Generation',
  contextCompression: '📦 Compress Context',
  pullAppContext: '🔽 Pull App Context',
  pushAppContext: '🔼 Push App Context',
  requestFilesFragments: '🧩 Request Files Fragments',
};

const toHumanReadable = (str: ActionType) => {
  return humanReadableActionTypes[str] || str;
};

export const PromptActionTypeSelector: React.FC<PromptActionTypeSelectorProps> = ({ value, onChange, disabled }) => {
  const [options, setOptions] = useState<ActionType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        setIsLoading(true);
        const fetchedOptions = await getActionTypeOptions();
        setOptions(fetchedOptions);
        setError(null);
      } catch (err) {
        setError('Failed to load action types.');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOptions();
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value);
  };

  return (
    <Container>
      <Select
        id="promptActionType"
        value={value || ''}
        onChange={handleChange}
        disabled={disabled || isLoading || error !== null}
      >
        <option value="">Auto mode</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {toHumanReadable(option)}
          </option>
        ))}
      </Select>
      {isLoading && <StatusMessage>Loading actions...</StatusMessage>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </Container>
  );
};

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Select = styled.select`
  padding: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
  font-size: 14px;
  max-width: 200px;

  &:disabled {
    background-color: ${({ theme }) => theme.colors.disabled};
    cursor: not-allowed;
  }

  option {
    padding: 4px;
    background-color: ${({ theme }) => theme.colors.inputBg};
    color: ${({ theme }) => theme.colors.inputText};
  }
`;

const StatusMessage = styled.div`
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
  font-style: italic;
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 14px;
`;

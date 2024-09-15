import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { CodegenOptions } from '../../../../codegen-types';
import { getDefaultCodegenOptions, updateCodegenOptions } from '../api/api-client';

interface CodegenOptionsPanelProps {
  onOptionsChange: (options: CodegenOptions) => void;
}

export const CodegenOptionsPanel: React.FC<CodegenOptionsPanelProps> = ({ onOptionsChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<CodegenOptions>({} as CodegenOptions);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const defaultOptions = await getDefaultCodegenOptions();
      const savedOptions = localStorage.getItem('codegenOptions');
      if (savedOptions) {
        setOptions({ ...defaultOptions, ...JSON.parse(savedOptions) });
      } else {
        setOptions(defaultOptions);
      }
    } catch (error) {
      console.error('Failed to load default options:', error);
    }
  };

  const handleOptionChange = (key: keyof CodegenOptions, value: any) => {
    const updatedOptions = { ...options, [key]: value };
    setOptions(updatedOptions);
    saveOptions(updatedOptions);
    onOptionsChange(updatedOptions);
  };

  const saveOptions = (updatedOptions: CodegenOptions) => {
    localStorage.setItem('codegenOptions', JSON.stringify(updatedOptions));
    updateCodegenOptions(updatedOptions).catch((error) => {
      console.error('Failed to update options on the server:', error);
    });
  };

  const togglePanel = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <OptionsButton onClick={togglePanel}>⚙️</OptionsButton>
      <OptionsPanel data-open={isOpen}>
        <h2>Codegen Options</h2>
        <OptionGroup>
          <OptionLabel>AI Service</OptionLabel>
          <OptionSelect value={options.aiService} onChange={(e) => handleOptionChange('aiService', e.target.value)}>
            <option value="vertex-ai">Vertex AI</option>
            <option value="ai-studio">AI Studio</option>
            <option value="vertex-ai-claude">Vertex AI Claude</option>
            <option value="chat-gpt">Chat GPT</option>
            <option value="anthropic">Anthropic</option>
          </OptionSelect>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>Temperature</OptionLabel>
          <OptionInput
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={options.temperature}
            onChange={(e) => handleOptionChange('temperature', parseFloat(e.target.value))}
          />
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.considerAllFiles}
              onChange={(e) => handleOptionChange('considerAllFiles', e.target.checked)}
            />
            Consider All Files
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.allowFileCreate}
              onChange={(e) => handleOptionChange('allowFileCreate', e.target.checked)}
            />
            Allow File Create
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.allowFileDelete}
              onChange={(e) => handleOptionChange('allowFileDelete', e.target.checked)}
            />
            Allow File Delete
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.allowDirectoryCreate}
              onChange={(e) => handleOptionChange('allowDirectoryCreate', e.target.checked)}
            />
            Allow Directory Create
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.allowFileMove}
              onChange={(e) => handleOptionChange('allowFileMove', e.target.checked)}
            />
            Allow File Move
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.vision}
              onChange={(e) => handleOptionChange('vision', e.target.checked)}
            />
            Enable Vision
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>Imagen</OptionLabel>
          <OptionSelect
            value={options.imagen || ''}
            onChange={(e) => handleOptionChange('imagen', e.target.value || undefined)}
          >
            <option value="">Disabled</option>
            <option value="vertex-ai">Vertex AI</option>
            <option value="dall-e">DALL-E</option>
          </OptionSelect>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.cheap}
              onChange={(e) => handleOptionChange('cheap', e.target.checked)}
            />
            Use Cheaper Model
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.dryRun}
              onChange={(e) => handleOptionChange('dryRun', e.target.checked)}
            />
            Dry Run
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.verbose}
              onChange={(e) => handleOptionChange('verbose', e.target.checked)}
            />
            Verbose
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.requireExplanations}
              onChange={(e) => handleOptionChange('requireExplanations', e.target.checked)}
            />
            Require Explanations
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.disableInitialLint}
              onChange={(e) => handleOptionChange('disableInitialLint', e.target.checked)}
            />
            Disable Initial Lint
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.askQuestion}
              onChange={(e) => handleOptionChange('askQuestion', e.target.checked)}
            />
            Ask Questions
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>
            <input
              type="checkbox"
              checked={options.disableCache}
              onChange={(e) => handleOptionChange('disableCache', e.target.checked)}
            />
            Disable Cache
          </OptionLabel>
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>Content Mask</OptionLabel>
          <OptionInput
            type="text"
            value={options.contentMask || ''}
            onChange={(e) => handleOptionChange('contentMask', e.target.value)}
          />
        </OptionGroup>
        <OptionGroup>
          <OptionLabel>Ignore Patterns (comma-separated)</OptionLabel>
          <OptionInput
            type="text"
            value={options.ignorePatterns?.join(',') || ''}
            onChange={(e) =>
              handleOptionChange(
                'ignorePatterns',
                e.target.value.split(',').map((s) => s.trim()),
              )
            }
          />
        </OptionGroup>
      </OptionsPanel>
    </>
  );
};

const OptionsButton = styled.button`
  background-color: ${({ theme }) => theme.colors.primary};
  color: white;
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s;

  &:hover {
    background-color: ${({ theme }) => theme.colors.primary}dd;
  }
`;

const OptionsPanel = styled.div`
  position: fixed;
  top: 60px;
  width: 300px;
  height: calc(100vh - 60px);
  background-color: ${({ theme }) => theme.colors.background};
  border-left: 1px solid ${({ theme }) => theme.colors.border};
  transition: right 0.3s ease-in-out;
  overflow-y: auto;
  padding: 20px;
  box-shadow: -2px 0 5px rgba(0, 0, 0, 0.1);
  z-index: 1000;

  &[data-open='true'] {
    right: 0;
  }

  &[data-open='false'] {
    right: -300px;
    display: none;
  }
`;

const OptionGroup = styled.div`
  margin-bottom: 15px;
`;

const OptionLabel = styled.label`
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.text};
`;

const OptionInput = styled.input`
  width: 100%;
  padding: 5px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
`;

const OptionSelect = styled.select`
  width: 100%;
  padding: 5px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background-color: ${({ theme }) => theme.colors.inputBg};
  color: ${({ theme }) => theme.colors.inputText};
`;

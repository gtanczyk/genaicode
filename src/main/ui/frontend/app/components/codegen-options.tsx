import React from 'react';
import styled from 'styled-components';
import { CodegenOptions, AiServiceType } from '../../../../codegen-types';

interface CodegenOptionsFormProps {
  options: CodegenOptions;
  onOptionsChange: (newOptions: CodegenOptions) => void;
  disabled: boolean;
}

export const CodegenOptionsForm: React.FC<CodegenOptionsFormProps> = ({ options, onOptionsChange, disabled }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    onOptionsChange({ ...options, [name]: newValue });
  };

  return (
    <FormContainer>
      <FormGroup>
        <Label htmlFor="aiService">AI Service:</Label>
        <Select
          id="aiService"
          name="aiService"
          value={options.aiService}
          onChange={handleChange}
          disabled={disabled}
        >
          <option value="vertex-ai">Vertex AI</option>
          <option value="ai-studio">AI Studio</option>
          <option value="chat-gpt">ChatGPT</option>
          <option value="anthropic">Anthropic</option>
          <option value="vertex-ai-claude">Vertex AI Claude</option>
        </Select>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="cheap">
          <input
            type="checkbox"
            id="cheap"
            name="cheap"
            checked={options.cheap}
            onChange={handleChange}
            disabled={disabled}
          />
          Cheap Mode
        </Label>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="contentMask">Content Mask:</Label>
        <Input
          type="text"
          id="contentMask"
          name="contentMask"
          value={options.contentMask || ''}
          onChange={handleChange}
          disabled={disabled}
        />
      </FormGroup>

      <FormGroup>
        <Label htmlFor="ignorePatterns">Ignore Patterns:</Label>
        <Input
          type="text"
          id="ignorePatterns"
          name="ignorePatterns"
          value={options.ignorePatterns ? options.ignorePatterns.join(', ') : ''}
          onChange={(e) => {
            const patterns = e.target.value.split(',').map((p) => p.trim());
            onOptionsChange({ ...options, ignorePatterns: patterns });
          }}
          disabled={disabled}
        />
        <small>Comma-separated list of patterns</small>
      </FormGroup>

      <FormGroup>
        <Label>File Operations:</Label>
        <Label htmlFor="allowFileCreate">
          <input
            type="checkbox"
            id="allowFileCreate"
            name="allowFileCreate"
            checked={options.allowFileCreate}
            onChange={handleChange}
            disabled={disabled}
          />
          Allow File Create
        </Label>
        <Label htmlFor="allowFileDelete">
          <input
            type="checkbox"
            id="allowFileDelete"
            name="allowFileDelete"
            checked={options.allowFileDelete}
            onChange={handleChange}
            disabled={disabled}
          />
          Allow File Delete
        </Label>
        <Label htmlFor="allowDirectoryCreate">
          <input
            type="checkbox"
            id="allowDirectoryCreate"
            name="allowDirectoryCreate"
            checked={options.allowDirectoryCreate}
            onChange={handleChange}
            disabled={disabled}
          />
          Allow Directory Create
        </Label>
        <Label htmlFor="allowFileMove">
          <input
            type="checkbox"
            id="allowFileMove"
            name="allowFileMove"
            checked={options.allowFileMove}
            onChange={handleChange}
            disabled={disabled}
          />
          Allow File Move
        </Label>
      </FormGroup>
    </FormContainer>
  );
};

const FormContainer = styled.div`
  background-color: ${(props) => props.theme.colors.backgroundSecondary};
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  padding: 16px;
  margin-top: 16px;
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 4px;
  color: ${(props) => props.theme.colors.text};
`;

const Input = styled.input`
  width: 100%;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.inputBg};
  color: ${(props) => props.theme.colors.inputText};

  &:disabled {
    background-color: ${(props) => props.theme.colors.disabled};
    cursor: not-allowed;
  }
`;

const Select = styled.select`
  width: 100%;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.colors.border};
  border-radius: 4px;
  background-color: ${(props) => props.theme.colors.inputBg};
  color: ${(props) => props.theme.colors.inputText};

  &:disabled {
    background-color: ${(props) => props.theme.colors.disabled};
    cursor: not-allowed;
  }
`;
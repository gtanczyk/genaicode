import React, { useState, useEffect } from 'react';
import { ThemeProvider } from 'styled-components';
import styled, { createGlobalStyle } from 'styled-components';
import CodegenExecutor from './components/codegen-executor.js';
import PromptHistory from './components/prompt-history.js';
import QuestionHandler from './components/question-handler.js';
import CodegenOutput from './components/codegen-output.js';
import ThemeToggle from './components/ThemeToggle';
import { lightTheme, darkTheme } from './theme/theme';
import {
  executeCodegen,
  getExecutionStatus,
  getPromptHistory,
  getCurrentQuestion,
  answerQuestion,
  getCodegenOutput,
  getAskQuestionConversation,
  getFunctionCalls,
  pauseExecution,
  resumeExecution,
  interruptExecution,
} from './api/api-client.js';

const GlobalStyle = createGlobalStyle`
  body {
    background-color: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 0;
    transition: all 0.3s ease;
  }
`;

const AppContainer = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
`;

const AppHeader = styled.h1`
  color: ${({ theme }) => theme.colors.primary};
  text-align: center;
`;

const AppLayout = styled.div`
  display: flex;
  gap: 20px;

  @media (max-width: 768px) {
    flex-direction: column;
  }
`;

const LeftPanel = styled.div`
  flex: 1;
`;

const RightPanel = styled.div`
  flex: 1;
`;

const GenAIcodeApp = () => {
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<{ id: string; text: string } | null>(null);
  const [codegenOutput, setCodegenOutput] = useState('');
  const [askQuestionConversation, setAskQuestionConversation] = useState<Array<{ question: string; answer: string }>>(
    [],
  );
  const [functionCalls, setFunctionCalls] = useState<Array<{ name: string; args: Record<string, unknown> }>>([]);
  const [theme, setTheme] = useState('light');

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    fetchPromptHistory();
    checkExecutionStatus();
    checkCurrentQuestion();
    fetchCodegenData();
  }, []);

  const fetchPromptHistory = async () => {
    try {
      const history = await getPromptHistory();
      setPromptHistory(history);
    } catch (error) {
      console.error('Failed to fetch prompt history:', error);
    }
  };

  const checkExecutionStatus = async () => {
    try {
      const status = await getExecutionStatus();
      setIsExecuting(status === 'running');
    } catch (error) {
      console.error('Failed to check execution status:', error);
    }
  };

  const checkCurrentQuestion = async () => {
    try {
      const question = await getCurrentQuestion();
      setCurrentQuestion(question);
    } catch (error) {
      console.error('Failed to fetch current question:', error);
    }
  };

  const fetchCodegenData = async () => {
    try {
      const output = await getCodegenOutput();
      const conversation = await getAskQuestionConversation();
      const calls = await getFunctionCalls();
      setCodegenOutput(output);
      setAskQuestionConversation(conversation);
      setFunctionCalls(calls);
    } catch (error) {
      console.error('Failed to fetch codegen data:', error);
    }
  };

  const handlePromptSubmit = async (prompt: string) => {
    setCurrentPrompt(prompt);
    setIsExecuting(true);
    try {
      await executeCodegen(prompt);
      await fetchPromptHistory();
      await checkExecutionStatus();
      await checkCurrentQuestion();
      await fetchCodegenData();
    } catch (error) {
      console.error('Failed to execute codegen:', error);
      setIsExecuting(false);
    }
  };

  const handlePause = async () => {
    try {
      await pauseExecution();
      setIsExecuting(false);
      console.log('Execution paused');
    } catch (error) {
      console.error('Failed to pause execution:', error);
    }
  };

  const handleResume = async () => {
    try {
      await resumeExecution();
      setIsExecuting(true);
      console.log('Execution resumed');
    } catch (error) {
      console.error('Failed to resume execution:', error);
    }
  };

  const handleInterrupt = async () => {
    try {
      await interruptExecution();
      setIsExecuting(false);
      console.log('Execution interrupted');
    } catch (error) {
      console.error('Failed to interrupt execution:', error);
    }
  };

  const handleQuestionSubmit = async (answer: string) => {
    if (currentQuestion) {
      try {
        await answerQuestion(currentQuestion.id, answer);
        setCurrentQuestion(null);
        await checkExecutionStatus();
        await checkCurrentQuestion();
        await fetchCodegenData();
      } catch (error) {
        console.error('Failed to submit answer:', error);
      }
    }
  };

  const handleReRun = (prompt: string) => {
    handlePromptSubmit(prompt);
  };

  return (
    <ThemeProvider theme={theme === 'light' ? lightTheme : darkTheme}>
      <GlobalStyle />
      <AppContainer>
        <AppHeader>GenAIcode</AppHeader>
        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
        <AppLayout>
          <LeftPanel>
            <CodegenExecutor
              onSubmit={handlePromptSubmit}
              onPause={handlePause}
              onResume={handleResume}
              onInterrupt={handleInterrupt}
              isExecuting={isExecuting}
            />
            {currentQuestion && <QuestionHandler onSubmit={handleQuestionSubmit} question={currentQuestion} />}
            <PromptHistory onReRun={handleReRun} promptHistory={promptHistory} />
          </LeftPanel>
          <RightPanel>
            <CodegenOutput
              output={codegenOutput}
              askQuestionConversation={askQuestionConversation}
              functionCalls={functionCalls}
            />
          </RightPanel>
        </AppLayout>
      </AppContainer>
    </ThemeProvider>
  );
};

export function App() {
  return (
    <GenAIcodeApp />
  );
}
import React, { useState } from 'react';

const PromptExecutor = () => {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult('');

    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/execute-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        throw new Error('Failed to execute prompt');
      }

      const data = await response.json();
      setResult(data.result);
    } catch (err) {
      setError('An error occurred while executing the prompt');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h2>Prompt Executor</h2>
      <form onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your prompt here"
          rows={4}
          cols={50}
        />
        <br />
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Executing...' : 'Execute Prompt'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {result && (
        <div>
          <h3>Result:</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export function App() {
  return (
    <div>
      <h1>Genaicode</h1>
      <PromptExecutor />
    </div>
  );
}

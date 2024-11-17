import { spawnSync } from 'child_process';
import { Plugin } from '../../src/index.js';

// Vitest JSON reporter output interface
interface VitestResult {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numPendingTestSuites: number;
  testResults: Array<{
    name: string;
    status: string;
    assertionResults: Array<{
      ancestorTitles: string[];
      title: string;
      status: string;
      failureMessages?: string[];
    }>;
  }>;
}

/**
 * Format test results for conversation
 */
function formatTestResults(results: VitestResult): string {
  let output = '📋 Test Results Summary:\n\n';

  // Add test suites summary
  output += `Test Suites: ${results.numFailedTestSuites} failed, ${results.numPassedTestSuites} passed, ${results.numTotalTestSuites} total\n\n`;

  // Add detailed test results
  output += '🔍 Detailed Results:\n\n';

  results.testResults.forEach((suite) => {
    const failedTests = suite.assertionResults.filter((test) => test.status === 'failed');
    const passedTests = suite.assertionResults.filter((test) => test.status === 'passed');

    output += `📁 ${suite.name}\n`;
    output += `   ✅ ${passedTests.length} passed, ❌ ${failedTests.length} failed\n\n`;

    // Show failed tests with details
    if (failedTests.length > 0) {
      output += '   Failed Tests:\n';
      failedTests.forEach((test) => {
        output += `   ❌ ${test.ancestorTitles.join(' > ')} > ${test.title}\n`;
        if (test.failureMessages) {
          output += '   Error:\n';
          test.failureMessages.forEach((message) => {
            // Clean up the error message
            const cleanMessage = message
              .split('\n')
              .filter((line) => !line.includes('node_modules'))
              .join('\n')
              .trim();
            output += `   ${cleanMessage}\n`;
          });
        }
        output += '\n';
      });
    }
  });

  return output;
}

const vitestRunner: Plugin = {
  name: 'vitest-runner',
  actionHandlers: {
    'run-tests': {
      description: 'Run Vitest test suite and report results',
      handler: async () => {
        try {
          const { putSystemMessage } = await import('../../src/index.js');
          putSystemMessage('Running Vitest tests in CI mode...');
          let { stdout } = spawnSync('npm', ['run', 'test:ci'], { encoding: 'utf-8' });
          stdout = stdout.split('\n').slice(3).join('\n').trim(); // Remove npm command output

          try {
            const results = JSON.parse(stdout) as VitestResult;
            const formattedResults = formatTestResults(results);

            // Return success result with conversation items
            return {
              breakLoop: false,
              items: [
                {
                  assistant: {
                    type: 'assistant',
                    text: 'Please execute unit tests and tell me the results.',
                  },
                  user: {
                    type: 'user',
                    text: formattedResults,
                  },
                },
              ],
            };
          } catch (parseError) {
            console.error('Error parsing test results:', parseError);

            // Return parse error result with conversation items
            return {
              breakLoop: true,
              items: [
                {
                  assistant: {
                    type: 'assistant',
                    text: 'Please execute unit tests and tell me the results.',
                  },
                  user: {
                    type: 'user',
                    text: `Error parsing test output: ${(parseError as Error).message}\nRaw output: ${stdout}`,
                  },
                },
              ],
            };
          }
        } catch (execError) {
          console.error('Error executing tests:', execError);
          const error = execError as { stdout?: string; stderr?: string };

          // Try to parse JSON from stdout even if the command failed
          // (Vitest might return non-zero exit code for test failures)
          if (error.stdout) {
            try {
              const results = JSON.parse(error.stdout) as VitestResult;
              const formattedResults = formatTestResults(results);

              // Return test failure result with conversation items
              return {
                breakLoop: true,
                items: [
                  {
                    assistant: {
                      type: 'assistant',
                      text: 'Please execute unit tests and tell me the results.',
                    },
                    user: {
                      type: 'user',
                      text: formattedResults,
                    },
                  },
                ],
              };
            } catch (parseError) {
              // If we can't parse the output, return the raw error
              return {
                breakLoop: true,
                items: [
                  {
                    assistant: {
                      type: 'assistant',
                      text: 'Please execute unit tests and tell me the results.',
                    },
                    user: {
                      type: 'user',
                      text: `Error details:\n${error.stderr || error.stdout || (execError as Error).message}`,
                    },
                  },
                ],
              };
            }
          }

          // Return execution error result with conversation items
          return {
            breakLoop: true,
            items: [
              {
                assistant: {
                  type: 'assistant',
                  text: 'Please execute unit tests and tell me the results.',
                },
                user: {
                  type: 'user',
                  text: `Error: ${(execError as Error).message}`,
                },
              },
            ],
          };
        }
      },
    },
  },
};

export default vitestRunner;

import { getSystemPrompt } from '../../prompt/systemprompt';

export const DEBUG_PROMPT_1 = [
  // System prompt
  {
    type: 'systemPrompt',
    systemPrompt: getSystemPrompt({ verbose: false, askQuestion: true, interactive: false, ui: true }),
  },
  {
    type: 'user',
    text: 'I should provide you with application source code.',
  },
  {
    type: 'assistant',
    text: 'Please provide application source code.',
    functionCalls: [
      {
        name: 'getSourceCode',
      },
      {
        name: 'readHistory',
      },
    ],
  },
  // Source code
  {
    type: 'user',
    functionResponses: [
      {
        name: 'getSourceCode',
        content: JSON.stringify({
          '/Users/gtanczyk/src/codegen': {
            'README.md': {
              summary:
                'Readme file for GenAIcode tool, an AI-powered code generation tool that enhances developer productivity.',
            },
            'knip.json': { summary: 'Configuration file for the Knip tool, used for code analysis and generation.' },
            'package.json': {
              summary:
                'Package configuration file for the GenAIcode tool, including dependencies, scripts, and other metadata.',
            },
            'tsconfig.json': { summary: 'TypeScript config for GenAICode project.' },
            'vitest.e2e.config.ts': { summary: 'Vitest config for e2e tests.' },
            'vitest.unit.config.ts': { summary: 'Vitest config for unit tests.' },
            'vitest.workspace.ts': { summary: 'Vitest workspace config.' },
          },
          '/Users/gtanczyk/src/codegen/bin': {
            'genaicode-dev.js': { summary: 'Development script for running GenAIcode tool.' },
          },
          '/Users/gtanczyk/src/codegen/docs/design': {
            'configuration.md': {
              summary:
                'Documentation on configuration options for the GenAIcode tool, including .genaicoderc file and lint command integration.',
            },
            'context_optimization_feature.md': {
              summary:
                'Design document for the context optimization feature in GenAIcode, aimed at reducing token usage.',
            },
            'features.md': {
              summary:
                'Documentation on additional features of the GenAIcode tool, such as dependency tree analysis, verbose mode, and vision capabilities.',
            },
            'file_operations.md': {
              summary:
                'Overview of file operations supported by the GenAIcode tool, including creating, deleting, and moving files.',
            },
            'genaicode_design_doc.md': {
              summary:
                'Main design document for the GenAIcode tool, providing an overview of its architecture, components, and features.',
            },
            'overview.md': {
              summary: 'High-level overview of the GenAIcode tool, its key features, and how it works.',
            },
            'token_usage_reduction.md': {
              summary: 'Design document for implementing strategies to reduce token usage in the GenAIcode tool.',
            },
          },
          '/Users/gtanczyk/src/codegen/docs/tasks': {
            'advanced_llm_prompt.md': {
              summary: 'Task description for analyzing and improving token reduction strategies in GenAIcode.',
            },
            'ai_token_usage.md': {
              summary: 'Task to implement token usage measurement and cost estimation for AI services in GenAIcode.',
            },
            'allow_directory_create.md': {
              summary: 'Task to add support for directory creation in the GenAIcode tool.',
            },
            'codegen_design_doc.md': {
              summary: 'Task to create a comprehensive design document for the GenAIcode tool.',
            },
            'configurable_extensions.md': {
              summary: 'Task to introduce configurable file extensions in the GenAIcode tool.',
            },
            'content_mask.md': {
              summary: 'Task to add a content mask feature to the GenAIcode tool for managing token usage.',
            },
            'context_shrinking.md': {
              summary:
                'Task to implement a context shrinking feature in the GenAIcode tool for optimizing token usage.',
            },
            'current_feedback.md': { summary: 'List of current feedback and improvements for the GenAIcode tool.' },
            'dependency_tree.md': {
              summary: 'Task to add a dependency tree feature to the GenAIcode tool for reducing token usage.',
            },
            'interactive_cli.md': { summary: 'Task to add an interactive CLI mode to the GenAIcode tool.' },
            'lint_step.md': {
              summary: 'Task to refactor the lint step in the GenAIcode tool for improved code quality.',
            },
            'multimodal_frontend.md': {
              summary: 'Task to add multimodal functionality to the GenAIcode web UI, including image support.',
            },
            'new_config_options.md': {
              summary: 'Task to add new configuration options to the .genaicoderc file in the GenAIcode tool.',
            },
            'project_structure_refactor.md': {
              summary: 'Task to refactor the project structure of the GenAIcode tool for improved maintainability.',
            },
            'step_ask_question_refactor.md': {
              summary: 'Task to refactor the `executeStepAskQuestion` function in the GenAIcode tool.',
            },
            'usage_monitoring.md': {
              summary: 'Implementation plan for a usage monitoring feature in the GenAIcode tool.',
            },
            'web_ui.md': { summary: 'Task to create a web-based user interface for the GenAIcode tool.' },
          },
          '/Users/gtanczyk/src/codegen/e2e-tests': {
            'genaicode-ui.test.ts': { summary: 'End-to-end test for the GenAIcode web UI.' },
          },
          '/Users/gtanczyk/src/codegen/examples': {
            'README.md': {
              summary:
                'Examples of applications generated using the GenAIcode tool, including Python, Golang, Java, and vision-based examples.',
            },
          },
          '/Users/gtanczyk/src/codegen/examples/genaicode_plugins': {
            'fake_ai_service.ts': { summary: 'Example plugin for a fake AI service in the GenAIcode tool.' },
            'grok_ai_service.ts': { summary: 'Example plugin for the Grok AI service in the GenAIcode tool.' },
            'nonsense_action_handler.ts': { summary: 'Plugin demonstrating action handling' },
            'nonsense_operation.ts': { summary: 'Example plugin for a nonsense operation in the GenAIcode tool.' },
          },
          '/Users/gtanczyk/src/codegen/examples/vite_genaicode_example': {
            'index.html': { summary: 'Example HTML file for the Vite GenAIcode plugin.' },
            'vite.config.ts': { summary: 'Example Vite configuration file for the GenAIcode plugin.' },
          },
          '/Users/gtanczyk/src/codegen/src/ai-service': {
            'ai-studio.ts': { summary: 'Implementation of the AI Studio service integration in the GenAIcode tool.' },
            'anthropic.ts': { summary: 'Anthropic AI service for generating content using the Claude model.' },
            'chat-gpt.ts': { summary: 'Implementation of the ChatGPT service integration in the GenAIcode tool.' },
            'common.test.ts': {
              summary: 'Unit tests for common functions in the AI service module of the GenAIcode tool.',
            },
            'common.ts': {
              summary: 'Common functions and types used across the AI service integrations in the GenAIcode tool.',
            },
            'dall-e.ts': { summary: 'Implementation of the DALL-E image generation service in the GenAIcode tool.' },
            'unescape-function-call.test.ts': {
              summary: 'Unit tests for the function call unescaping utility in the GenAIcode tool.',
            },
            'unescape-function-call.ts': {
              summary: 'Utility function to unescape function call arguments in the GenAIcode tool.',
            },
            'vertex-ai-claude.ts': {
              summary: 'Implementation of the Vertex AI Claude service integration in the GenAIcode tool.',
            },
            'vertex-ai-imagen.ts': {
              summary: 'Implementation of the Vertex AI Imagen image generation service in the GenAIcode tool.',
            },
            'vertex-ai.ts': {
              summary: 'Implementation of the Vertex AI Gemini Pro service integration in the GenAIcode tool.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/cli': {
            'cli-options.test.ts': { summary: 'Unit tests for the CLI options in the GenAIcode tool.' },
            'cli-options.ts': { summary: 'Defines CLI options and their descriptions.' },
            'cli-params.test.ts': { summary: 'Unit tests for the CLI parameter handling in the GenAIcode tool.' },
            'cli-params.ts': { summary: 'Handles parsing and validating CLI parameters.' },
            'service-autodetect.test.ts': { summary: 'Tests for auto-detecting AI service from env vars.' },
            'service-autodetect.ts': { summary: 'Detects AI service based on env vars.' },
            'validate-cli-params.test.ts': { summary: 'Tests for validating CLI parameters.' },
            'validate-cli-params.ts': { summary: 'Validates CLI parameters according to README.' },
          },
          '/Users/gtanczyk/src/codegen/src/files': {
            'cache-file.ts': { summary: 'Caching utilities for source code and image assets.' },
            'file-utils.test.ts': { summary: 'Tests for file utility functions.' },
            'file-utils.ts': { summary: 'Utility functions for working with file paths.' },
            'find-files.ts': { summary: 'Finds source files and image assets in the project.' },
            'path-utils.ts': { summary: 'Utility functions for working with file paths.' },
            'read-files.test.ts': { summary: 'Unit tests for file reading utilities' },
            'read-files.ts': { summary: 'Utilities to read source code and image assets' },
            'source-code-tree.ts': {
              summary: 'Defines SourceCodeTree type, getSourceCodeTree and parseSourceCodeTree functions.',
            },
            'temp-buffer.ts': { summary: 'Temporary storage for image data.' },
            'update-files.ts': { summary: 'Updates files based on code generation results.' },
          },
          '/Users/gtanczyk/src/codegen/src/images': {
            'ensure-alpha.ts': { summary: 'Ensures alpha channel for images.' },
            'imgly-remove-background.ts': {
              summary: 'Removes background from images using @imgly/background-removal-node.',
            },
            'resize-image.ts': { summary: 'Resizes images.' },
            'split-image.ts': { summary: 'Splits images into parts.' },
          },
          '/Users/gtanczyk/src/codegen/src': { 'index.ts': { summary: 'Exports main codegen types and functions.' } },
          '/Users/gtanczyk/src/codegen/src/main': {
            'codegen-types.ts': {
              // content: null,
              // "import { FunctionDef, GenerateContentFunction } from '../ai-service/common';\nimport { ActionHandler } from '../prompt/steps/step-ask-question/step-ask-question-types';\n\n/** Example: {@link ../../examples/genaicode_plugins/grok_ai_service.ts} */\nexport type PluginAiServiceType = `plugin:${string}`;\n\n/** Example: {@link ../../examples/genaicode_plugins/nonsense_action_handlers.ts} */\nexport type PluginActionType = `plugin:${string}`;\n\nexport type AiServiceType =\n  | 'vertex-ai'\n  | 'ai-studio'\n  | 'vertex-ai-claude'\n  | 'chat-gpt'\n  | 'anthropic'\n  | PluginAiServiceType;\n\nexport type ImagenType = 'vertex-ai' | 'dall-e';\n\nexport interface UploadedImage {\n  base64url: string;\n  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';\n  originalName: string;\n}\n\nexport interface CodegenOptions {\n  explicitPrompt?: string;\n  taskFile?: string;\n  considerAllFiles?: boolean;\n  allowFileCreate?: boolean;\n  allowFileDelete?: boolean;\n  allowDirectoryCreate?: boolean;\n  allowFileMove?: boolean;\n  vision?: boolean;\n  imagen?: ImagenType;\n  aiService: AiServiceType;\n\n  disableContextOptimization?: boolean;\n  temperature?: number;\n  cheap?: boolean;\n  dryRun?: boolean;\n  verbose?: boolean;\n  requireExplanations?: boolean;\n  geminiBlockNone?: boolean;\n  disableInitialLint?: boolean;\n  contentMask?: string;\n  ignorePatterns?: string[];\n  askQuestion?: boolean;\n  interactive?: boolean;\n  ui?: boolean;\n  uiPort?: number;\n  uiFrameAncestors?: string[];\n  disableCache?: boolean;\n  dependencyTree?: boolean;\n  historyEnabled?: boolean;\n\n  disableAiServiceFallback?: boolean;\n  conversationSummaryEnabled?: boolean;\n  images?: UploadedImage[];\n  isDev?: boolean;\n}\n\ninterface ExecutorArgs {\n  [key: string]: unknown;\n}\n\nexport type OperationExecutor = (args: ExecutorArgs, options: CodegenOptions) => Promise<void>;\n\nexport type Operation = {\n  executor: OperationExecutor;\n  def: FunctionDef;\n};\n\nexport interface Plugin {\n  name: string;\n  aiServices?: Record<string, GenerateContentFunction>;\n  operations?: Record<string, Operation>;\n  actionHandlers?: Record<\n    string,\n    {\n      /** The action handler implementation */\n      handler: ActionHandler;\n      /**\n       * Description of what this action handler does.\n       * This description will be included in the askQuestion function definition\n       * to help the AI understand when to use this action.\n       */\n      description: string;\n    }\n  >;\n}\n",
            },
            'codegen-utils.ts': { summary: 'Utility functions for codegen.' },
            'codegen.test.ts': { summary: 'Tests the codegen functionality.' },
            'codegen.ts': {
              // content: null,
              // "import { exec } from 'child_process';\nimport util from 'util';\n\nimport * as cliParams from '../cli/cli-params.js';\nimport { validateCliParams } from '../cli/validate-cli-params.js';\nimport { generateContent as generateContentVertexAi } from '../ai-service/vertex-ai.js';\nimport { generateContent as generateContentGPT } from '../ai-service/chat-gpt.js';\nimport { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';\nimport { generateContent as generateContentVertexAiClaude } from '../ai-service/vertex-ai-claude.js';\nimport { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';\nimport { generateImage as generateImageDallE } from '../ai-service/dall-e.js';\nimport { generateImage as generateImageVertexAi } from '../ai-service/vertex-ai-imagen.js';\n\nimport { promptService } from '../prompt/prompt-service.js';\nimport { updateFiles } from '../files/update-files.js';\nimport { rcConfig } from '../main/config.js';\nimport { AiServiceType, CodegenOptions, ImagenType } from './codegen-types.js';\nimport { getLintFixPrompt } from '../prompt/prompt-codegen.js';\nimport { printHelpMessage } from '../cli/cli-options.js';\nimport { FunctionCall, GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.js';\nimport { getCodeGenPrompt } from '../prompt/prompt-codegen.js';\n\nimport { runInteractiveMode } from './interactive/codegen-interactive.js';\nimport { runCodegenUI } from './ui/codegen-ui.js';\nimport {\n  putSystemMessage,\n  putUserMessage,\n  setCurrentIterationId,\n  unsetCurrentIterationId,\n} from './common/content-bus.js';\nimport { refreshFiles } from '../files/find-files.js';\nimport { getRegisteredAiServices } from './plugin-loader.js';\nimport { stringToAiServiceType } from './codegen-utils.js';\n\n/** Executes codegen */\nexport async function runCodegen(isDev = false): Promise<void> {\n  // Print to console the received parameters\n  console.log(`Received parameters: ${process.argv.slice(2).join(' ')}`);\n\n  validateCliParams();\n\n  // Handle --help option\n  if (cliParams.helpRequested) {\n    printHelpMessage();\n    return;\n  }\n\n  const options: CodegenOptions = {\n    explicitPrompt: cliParams.explicitPrompt,\n    taskFile: cliParams.taskFile,\n    considerAllFiles: cliParams.considerAllFiles,\n    dependencyTree: cliParams.dependencyTree,\n\n    allowFileCreate: cliParams.allowFileCreate,\n    allowFileDelete: cliParams.allowFileDelete,\n    allowDirectoryCreate: cliParams.allowDirectoryCreate,\n    allowFileMove: cliParams.allowFileMove,\n\n    aiService: stringToAiServiceType(cliParams.aiService),\n    vision: cliParams.vision,\n    imagen: cliParams.imagen,\n\n    disableContextOptimization: cliParams.disableContextOptimization,\n    temperature: cliParams.temperature,\n    cheap: cliParams.cheap,\n    dryRun: cliParams.dryRun,\n    verbose: cliParams.verbosePrompt,\n    requireExplanations: !cliParams.disableExplanations,\n    geminiBlockNone: cliParams.geminiBlockNone,\n    disableInitialLint: cliParams.disableInitialLint,\n    contentMask: cliParams.contentMask,\n    ignorePatterns: cliParams.ignorePatterns,\n    askQuestion: cliParams.askQuestion,\n    disableCache: cliParams.disableCache,\n    interactive: cliParams.interactive,\n    ui: cliParams.ui,\n    uiPort: cliParams.uiPort,\n    disableAiServiceFallback: cliParams.disableAiServiceFallback,\n    historyEnabled: !cliParams.disableHistory,\n    conversationSummaryEnabled: !cliParams.disableConversationSummary,\n\n    isDev,\n  };\n\n  if (cliParams.ui) {\n    await runCodegenUI(options);\n  } else if (cliParams.interactive) {\n    // Handle interactive mode\n    await runInteractiveMode(options);\n  } else {\n    console.log('Executing codegen in non-interactive mode');\n    await runCodegenIteration(options);\n  }\n}\n\nexport async function runCodegenIteration(\n  options: CodegenOptions,\n  abortSignal?: AbortSignal,\n  waitIfPaused: () => Promise<void> = () => Promise.resolve(),\n) {\n  refreshFiles();\n\n  setCurrentIterationId();\n\n  putUserMessage(\n    options.explicitPrompt ?? options.taskFile ?? 'Run codegen iteration without explicit prompt.',\n    undefined,\n    undefined,\n    options.images,\n  );\n\n  if (rcConfig.lintCommand && !options.disableInitialLint) {\n    try {\n      putSystemMessage(`Executing lint command: ${rcConfig.lintCommand}`);\n      await execPromise(rcConfig.lintCommand, { cwd: rcConfig.rootDir });\n      putSystemMessage('Lint command executed successfully');\n    } catch (error) {\n      const { stderr, stdout } = error as { stdout: string; stderr: string };\n      putSystemMessage(\n        'Lint command failed. Aborting codegen, please fix lint issues before running codegen, or use --disable-initial-lint',\n      );\n      console.log('Lint errors:', stdout, stderr);\n      unsetCurrentIterationId();\n      return;\n    }\n  } else if (rcConfig.lintCommand && options.disableInitialLint) {\n    console.log('Initial lint was skipped.');\n  }\n\n  if (abortSignal?.aborted) {\n    unsetCurrentIterationId();\n    throw new Error('Codegen iteration aborted');\n  }\n\n  await waitIfPaused();\n\n  putSystemMessage('Generating response');\n  try {\n    const functionCalls = await promptService(\n      getGenerateContentFunctions(),\n      GENERATE_IMAGE_FNS,\n      getCodeGenPrompt(options),\n      waitIfPaused,\n    );\n    console.log('Received function calls:', functionCalls);\n\n    await waitIfPaused();\n\n    if (functionCalls.length === 0) {\n      putSystemMessage('No updates to apply');\n    } else if (options.dryRun) {\n      putSystemMessage('Dry run mode, not updating files');\n    } else {\n      putSystemMessage('Update files');\n      await updateFiles(\n        functionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),\n        options,\n      );\n      putSystemMessage('Initial updates applied');\n\n      if (abortSignal?.aborted) {\n        throw new Error('Codegen iteration aborted after initial updates');\n      }\n\n      await waitIfPaused();\n\n      // Check if lintCommand is specified in .genaicoderc\n      if (rcConfig.lintCommand && functionCalls.length > 0) {\n        try {\n          putSystemMessage(`Executing lint command: ${rcConfig.lintCommand}`);\n          await execPromise(rcConfig.lintCommand, { cwd: rcConfig.rootDir });\n          putSystemMessage('Lint command executed successfully');\n        } catch (error) {\n          putSystemMessage('Lint command failed. Attempting to fix issues...');\n\n          // Prepare the lint error output for the second pass\n          const firstLintError = error as { stdout: string; stderr: string };\n          const lintErrorPrompt = getLintFixPrompt(\n            rcConfig.lintCommand,\n            options,\n            firstLintError.stdout,\n            firstLintError.stderr,\n          );\n\n          putSystemMessage('Generating response for lint fixes');\n          const lintFixFunctionCalls = (await promptService(\n            getGenerateContentFunctions(),\n            GENERATE_IMAGE_FNS,\n            {\n              prompt: lintErrorPrompt,\n              options: { ...options, considerAllFiles: true },\n            },\n            waitIfPaused,\n          )) as FunctionCall[];\n\n          console.log('Received function calls for lint fixes:', lintFixFunctionCalls);\n\n          await waitIfPaused();\n\n          putSystemMessage('Applying lint fixes');\n          updateFiles(\n            lintFixFunctionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),\n            options,\n          );\n\n          if (abortSignal?.aborted) {\n            throw new Error('Codegen iteration aborted after lint fixes');\n          }\n\n          // Run lint command again to verify fixes\n          try {\n            putSystemMessage(`Re-running lint command: ${rcConfig.lintCommand}`);\n            await execPromise(rcConfig.lintCommand);\n            putSystemMessage('Lint command executed successfully after fixes');\n          } catch (secondLintError) {\n            const error = secondLintError as { stdout: string; stderr: string };\n            putSystemMessage('Lint command still failing after fixes. Manual intervention may be required.');\n            console.log('Lint errors:', error.stdout, error.stderr);\n          }\n        }\n      }\n\n      console.log('Done!');\n    }\n  } catch (error) {\n    if (error instanceof Error) {\n      if (error.name === 'AbortError' || error.message.includes('interrupted')) {\n        putSystemMessage('Codegen iteration was interrupted');\n      } else if (error.message.includes('Rate limit exceeded')) {\n        putSystemMessage(\n          'Rate limit exceeded. Consider switching to a different AI service or waiting before retrying.',\n        );\n      } else {\n        putSystemMessage(`An error occurred during codegen: ${error.message}`);\n      }\n    } else {\n      putSystemMessage('An unknown error occurred during codegen');\n    }\n    console.error('Error details:', error);\n  } finally {\n    unsetCurrentIterationId();\n  }\n}\n\n// helper functions and consts\n\nconst execPromise = util.promisify(exec);\n\nfunction getGenerateContentFunctions(): Record<AiServiceType, GenerateContentFunction> {\n  return {\n    'vertex-ai-claude': generateContentVertexAiClaude,\n    'vertex-ai': generateContentVertexAi,\n    'ai-studio': generateContentAiStudio,\n    anthropic: generateContentAnthropic,\n    'chat-gpt': generateContentGPT,\n    ...Object.fromEntries(getRegisteredAiServices().entries()),\n  };\n}\n\nconst GENERATE_IMAGE_FNS: Record<ImagenType, GenerateImageFunction> = {\n  'dall-e': generateImageDallE,\n  'vertex-ai': generateImageVertexAi,\n} as const;\n",
            },
            'config-lib.test.ts': { summary: 'Tests for the configuration library.' },
            'config-lib.ts': { summary: 'Reads and parses the .genaicoderc configuration file.' },
            'config.ts': { summary: 'Loads the configuration and sets up the environment.' },
            'plugin-loader.ts': { summary: 'Loads and registers plugins.' },
          },
          '/Users/gtanczyk/src/codegen/src/main/common': {
            'content-bus-types.ts': { summary: 'Types for the content bus.' },
            'content-bus.ts': { summary: 'Handles content updates and messaging.' },
            'cost-collector.ts': { summary: 'Collects and reports usage metrics for AI services.' },
            'user-actions.ts': { summary: 'Handles user input and confirmation.' },
          },
          '/Users/gtanczyk/src/codegen/src/main/interactive': {
            'codegen-interactive.test.ts': { summary: 'Tests for the interactive codegen mode.' },
            'codegen-interactive.ts': { summary: 'Implements the interactive codegen mode.' },
            'codegen-worker.ts': { summary: 'Runs codegen in a separate process with interrupt handling.' },
            'common.ts': { summary: 'Common utilities for the interactive mode.' },
            'configure.ts': { summary: 'Handles configuration options in the interactive mode.' },
            'error-handling.ts': { summary: 'Handles errors in the interactive mode.' },
            'help.ts': { summary: 'Displays help information for the interactive mode.' },
            'process-comments.ts': { summary: 'Processes codegen comments in the interactive mode.' },
            'select-ai-service.ts': { summary: 'Allows selecting the AI service in the interactive mode.' },
            'task-file.ts': { summary: 'Handles task file selection in the interactive mode.' },
            'text-prompt.ts': { summary: 'Handles text prompt input in the interactive mode.' },
            'user-action-handlers.ts': { summary: 'Implements user input and confirmation handlers' },
            'user-interrupt.ts': { summary: 'Handles user interrupts in the interactive mode.' },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/backend': {
            'api-utils.ts': { summary: 'Utility functions for the API.' },
            'api.ts': { summary: 'API routes for code generation' },
            'server.ts': { summary: 'Starts the web server for the UI.' },
            'service.ts': { summary: 'Codegen service with execution control, question handling, and usage metrics' },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui': {
            'codegen-ui.ts': { summary: 'Runs the web UI for codegen.' },
            'user-action-handlers.ts': { summary: 'Registers user input and confirmation handlers' },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/common': {
            'api-types.ts': { summary: 'Defines types for the web UI API.' },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/api': {
            'api-client.ts': { summary: 'Provides API client for interacting with the backend' },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/components': {
            'app-handlers.tsx': {
              // content: null,
              // "import { useCallback } from 'react';\nimport { AiServiceType, CodegenOptions } from '../../../../codegen-types.js';\nimport {\n  executeCodegen,\n  getExecutionStatus,\n  getCurrentQuestion,\n  answerQuestion,\n  interruptExecution,\n  pauseExecution,\n  resumeExecution,\n} from '../api/api-client.js';\nimport { ChatMessage } from '../../../../common/content-bus-types.js';\nimport { Question } from '../../../common/api-types.js';\n\ninterface AppHandlersProps {\n  currentPrompt: string;\n  setCurrentPrompt: React.Dispatch<React.SetStateAction<string>>;\n  isExecuting: boolean;\n  setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>;\n  setExecutionStatus: React.Dispatch<React.SetStateAction<'executing' | 'idle' | 'paused'>>;\n  chatMessages: ChatMessage[];\n  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;\n  setCurrentQuestion: React.Dispatch<React.SetStateAction<Question | null>>;\n  codegenOptions: CodegenOptions;\n  setCodegenOptions: (options: CodegenOptions) => void;\n}\n\nexport const AppHandlers = ({\n  setCurrentPrompt,\n  setIsExecuting,\n  setExecutionStatus,\n  setChatMessages,\n  setCurrentQuestion,\n  codegenOptions,\n  setCodegenOptions,\n}: AppHandlersProps) => {\n  const handleExecute = async (prompt: string, images: File[]) => {\n    setCurrentPrompt(prompt);\n    setIsExecuting(true);\n\n    try {\n      setIsExecuting(true);\n      setExecutionStatus('executing');\n\n      if ((await getExecutionStatus()) === 'executing') {\n        console.warn('Execution is already executing');\n        return;\n      }\n\n      executeCodegen(prompt, codegenOptions, images.length > 0 ? images : undefined);\n    } catch (error) {\n      console.error('Failed to execute codegen:', error);\n    } finally {\n      setIsExecuting(false);\n      setExecutionStatus('idle');\n    }\n  };\n\n  const handleQuestionSubmit = async (answer: string, confirmed?: boolean, aiService?: AiServiceType) => {\n    const currentQuestion = await getCurrentQuestion();\n    if (currentQuestion) {\n      try {\n        setCurrentQuestion(null);\n        await answerQuestion(currentQuestion.id, answer, confirmed, {\n          ...codegenOptions,\n          aiService: aiService ?? codegenOptions.aiService,\n        });\n      } catch (error) {\n        console.error('Failed to submit answer:', error);\n      }\n    }\n  };\n\n  const handleInterrupt = async () => {\n    try {\n      setCurrentQuestion(null);\n      await interruptExecution();\n    } catch (error) {\n      console.error('Failed to interrupt execution:', error);\n    }\n  };\n\n  const handleOptionsChange = useCallback(\n    (newOptions: CodegenOptions) => {\n      setCodegenOptions(newOptions);\n    },\n    [setCodegenOptions, setChatMessages],\n  );\n\n  const handlePauseExecution = useCallback(async () => {\n    try {\n      await pauseExecution();\n    } catch (error) {\n      console.error('Failed to pause execution:', error);\n    }\n  }, [setExecutionStatus, setChatMessages]);\n\n  const handleResumeExecution = useCallback(async () => {\n    try {\n      await resumeExecution();\n    } catch (error) {\n      console.error('Failed to resume execution:', error);\n    }\n  }, [setExecutionStatus, setChatMessages]);\n\n  return {\n    handleExecute,\n    handleQuestionSubmit,\n    handleInterrupt,\n    handleOptionsChange,\n    handlePauseExecution,\n    handleResumeExecution,\n  };\n};\n",
            },
            'app-layout.tsx': {
              summary:
                'Defines the layout of the application, including the header, usage display, and main content area.',
            },
            'app-state.tsx': {
              // content: null,
              // "import { useState, useEffect, useCallback, useRef } from 'react';\nimport {\n  getExecutionStatus,\n  getCurrentQuestion,\n  getUsage,\n  getDefaultCodegenOptions,\n  getRcConfig,\n  getContent,\n  pauseExecution,\n  resumeExecution,\n} from '../api/api-client.js';\nimport { Question, Usage } from '../../../common/api-types.js';\nimport { ChatMessage } from '../../../../common/content-bus-types.js';\nimport { RcConfig } from '../../../../config-lib.js';\nimport { CodegenOptions } from '../../../../codegen-types.js';\n\ntype ExecutionStatus = 'idle' | 'executing' | 'paused';\n\nconst POLLING_INTERVAL = 500; // 0.5 seconds\n\nexport const AppState = () => {\n  const [currentPrompt, setCurrentPrompt] = useState('');\n  const [isExecuting, setIsExecuting] = useState(false);\n  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');\n  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);\n  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);\n  const [theme, setTheme] = useState('dark');\n  const [usage, setUsage] = useState<Usage>();\n  const [codegenOptions, setCodegenOptions] = useState<CodegenOptions>({} as CodegenOptions);\n  const [rcConfig, setRcConfig] = useState<RcConfig | null>(null);\n  const [lastFinishedExecutionId, setLastFinishedExecutionId] = useState<string | null>(null);\n  const [isPolling, setIsPolling] = useState(false);\n  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);\n\n  const toggleTheme = () => {\n    setTheme(theme === 'light' ? 'dark' : 'light');\n  };\n\n  useEffect(() => {\n    const fetchInitialData = async () => {\n      try {\n        const [status, question, content, usage, defaultOptions, config] = await Promise.all([\n          getExecutionStatus(),\n          getCurrentQuestion(),\n          getContent(),\n          getUsage(),\n          getDefaultCodegenOptions(),\n          getRcConfig(),\n        ]);\n\n        setIsExecuting(status !== 'idle');\n        setExecutionStatus(status);\n        setCurrentQuestion(question);\n        setChatMessages(\n          content\n            .filter((content) => !!content.message)\n            .map((content) => ({\n              ...content.message!,\n              data: content.data,\n            })),\n        );\n        setUsage(usage);\n        setCodegenOptions(defaultOptions);\n        setRcConfig(config);\n      } catch (error) {\n        console.error('Failed to fetch initial data:', error);\n      }\n    };\n\n    fetchInitialData();\n  }, []);\n\n  const startPolling = useCallback(() => {\n    if (!isPolling) {\n      setIsPolling(true);\n      const poll = async () => {\n        try {\n          const [status, question, content, usage] = await Promise.all([\n            getExecutionStatus(),\n            getCurrentQuestion(),\n            getContent(),\n            getUsage(),\n          ]);\n\n          setIsExecuting(status !== 'idle');\n          setExecutionStatus(status);\n          setCurrentQuestion(question);\n          setChatMessages(\n            content\n              .filter((content) => !!content.message)\n              .map((content) => ({\n                ...content.message!,\n                data: content.data,\n              })),\n          );\n          setUsage(usage);\n        } catch (error) {\n          console.error('Failed to poll data:', error);\n        }\n        pollingTimeoutRef.current = setTimeout(poll, POLLING_INTERVAL);\n      };\n      poll();\n    }\n  }, [isPolling]);\n\n  const stopPolling = useCallback(() => {\n    if (isPolling) {\n      setIsPolling(false);\n      if (pollingTimeoutRef.current) {\n        clearTimeout(pollingTimeoutRef.current);\n        pollingTimeoutRef.current = null;\n      }\n    }\n  }, [isPolling]);\n\n  const handlePauseExecution = useCallback(async () => {\n    try {\n      await pauseExecution();\n      setExecutionStatus('paused');\n    } catch (error) {\n      console.error('Failed to pause execution:', error);\n    }\n  }, []);\n\n  const handleResumeExecution = useCallback(async () => {\n    try {\n      await resumeExecution();\n      setExecutionStatus('executing');\n    } catch (error) {\n      console.error('Failed to resume execution:', error);\n    }\n  }, []);\n\n  return {\n    currentPrompt,\n    setCurrentPrompt,\n    isExecuting,\n    setIsExecuting,\n    executionStatus,\n    setExecutionStatus,\n    chatMessages,\n    setChatMessages,\n    currentQuestion,\n    theme,\n    usage,\n    codegenOptions,\n    rcConfig,\n    lastFinishedExecutionId,\n    toggleTheme,\n    setCodegenOptions,\n    setCurrentQuestion,\n    setLastFinishedExecutionId,\n    startPolling,\n    stopPolling,\n    handlePauseExecution,\n    handleResumeExecution,\n  };\n};\n",
            },
            'chat-interface.tsx': { summary: 'Renders the chat interface with message history and question handling' },
            'info-icon.tsx': {
              summary: 'Renders an information icon that displays the RcConfig settings in a tooltip.',
            },
            'progress-indicator.tsx': {
              summary: 'Renders the progress indicator, including the interrupt and pause/resume buttons.',
            },
            'question-handler.tsx': {
              summary: 'React component for handling user questions and code generation confirmation.',
            },
            'styled-textarea.tsx': {
              summary:
                'Renders a styled textarea component with automatic height adjustment and image pasting support.',
            },
            'theme-toggle.tsx': {
              summary: 'Renders a button to toggle the application theme between light and dark mode.',
            },
            'unread-messages-notification.tsx': {
              summary: 'Renders a notification for unread messages in the chat interface.',
            },
            'usage-display.tsx': {
              summary: 'Renders the usage display, including the cost, RPM, RPD, TPM, and TPD metrics.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/components/chat': {
            'data-container.tsx': { summary: 'Renders data in a formatted container.' },
            'message-container.tsx': {
              summary: 'Renders a chat message, including user/assistant messages, images, and data.',
            },
            'system-message-container.tsx': {
              summary: 'Renders a system message container, including collapsible execution details and data.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/components/chat/styles': {
            'chat-interface-styles.ts': {
              summary:
                'Defines styles for the chat interface, including the chat container, messages container, and iteration header.',
            },
            'data-container-styles.ts': { summary: 'Defines styles for the data container component.' },
            'message-container-styles.ts': { summary: 'Defines styles for the message container component.' },
            'system-message-container-styles.ts': {
              summary: 'Defines the styles for the system message container component',
            },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/components/input-area': {
            'ai-service-selector.tsx': {
              // content: null,
              //   "import React, { useState, useEffect } from 'react';\nimport styled from 'styled-components';\nimport { AiServiceType } from '../../../../../codegen-types';\nimport { getAvailableAiServices } from '../../api/api-client';\n\ninterface AiServiceSelectorProps {\n  value: AiServiceType;\n  onChange: (value: AiServiceType) => void;\n  disabled?: boolean;\n}\n\nexport const AiServiceSelector: React.FC<AiServiceSelectorProps> = ({ value, onChange, disabled }) => {\n  const [availableServices, setAvailableServices] = useState<AiServiceType[]>([]);\n  const [error, setError] = useState<string | null>(null);\n\n  useEffect(() => {\n    const fetchAiServices = async () => {\n      try {\n        const services = await getAvailableAiServices();\n        setAvailableServices(services);\n      } catch (err) {\n        console.error('Error fetching AI services:', err);\n        setError('Failed to fetch available AI services.');\n      }\n    };\n\n    fetchAiServices();\n  }, []);\n\n  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {\n    onChange(event.target.value as AiServiceType);\n  };\n\n  return (\n    <Container>\n      <Select id=\"aiService\" value={value} onChange={handleChange} disabled={disabled || error !== null}>\n        <option value=\"\">Select AI Service</option>\n        {availableServices.map((service) => (\n          <option key={service} value={service}>\n            {service}\n          </option>\n        ))}\n      </Select>\n      {error && <ErrorMessage>{error}</ErrorMessage>}\n    </Container>\n  );\n};\n\nconst Container = styled.div`\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n`;\n\nconst Select = styled.select`\n  padding: 8px;\n  border: 1px solid ${({ theme }) => theme.colors.border};\n  border-radius: 4px;\n  background-color: ${({ theme }) => theme.colors.inputBg};\n  color: ${({ theme }) => theme.colors.inputText};\n  font-size: 14px;\n\n  &:disabled {\n    background-color: ${({ theme }) => theme.colors.disabled};\n    cursor: not-allowed;\n  }\n`;\n\nconst ErrorMessage = styled.div`\n  color: ${({ theme }) => theme.colors.error};\n  font-size: 14px;\n`;\n",
            },
            'button-container.tsx': {
              summary: 'Renders the buttons for the input area, including submit, upload images, and configuration.',
            },
            'codegen-options-form.tsx': {
              // content: null,
              // 'import React from \'react\';\nimport styled from \'styled-components\';\nimport { CodegenOptions } from \'../../../../../codegen-types.js\';\nimport { AiServiceSelector } from \'./ai-service-selector\';\n\ninterface CodegenOptionsFormProps {\n  options: CodegenOptions;\n  onOptionsChange: (newOptions: CodegenOptions) => void;\n  disabled: boolean;\n}\n\nexport const CodegenOptionsForm: React.FC<CodegenOptionsFormProps> = ({ options, onOptionsChange, disabled }) => {\n  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {\n    const { name, value, type } = e.target;\n    const newValue = type === \'checkbox\' ? !(e.target as HTMLInputElement).checked : value;\n    onOptionsChange({ ...options, [name]: newValue });\n  };\n\n  const handleAiServiceChange = (aiService: string) => {\n    onOptionsChange({ ...options, aiService: aiService as CodegenOptions[\'aiService\'] });\n  };\n\n  return (\n    <FormContainer>\n      <FormGroup>\n        <Label htmlFor="aiService">AI Service:</Label>\n        <AiServiceSelector value={options.aiService} onChange={handleAiServiceChange} disabled={disabled} />\n      </FormGroup>\n\n      <FormGroup>\n        <Label htmlFor="cheap">\n          <input\n            type="checkbox"\n            id="cheap"\n            name="cheap"\n            checked={options.cheap}\n            onChange={handleChange}\n            disabled={disabled}\n          />\n          Cheap Mode\n        </Label>\n      </FormGroup>\n\n      <FormGroup>\n        <Label htmlFor="contentMask">Content Mask:</Label>\n        <Input\n          type="text"\n          id="contentMask"\n          name="contentMask"\n          value={options.contentMask || \'\'}\n          onChange={handleChange}\n          disabled={disabled}\n        />\n      </FormGroup>\n\n      <FormGroup>\n        <Label htmlFor="ignorePatterns">Ignore Patterns:</Label>\n        <Input\n          type="text"\n          id="ignorePatterns"\n          name="ignorePatterns"\n          value={options.ignorePatterns ? options.ignorePatterns.join(\', \') : \'\'}\n          onChange={(e) => {\n            const patterns = e.target.value.split(\',\').map((p) => p.trim());\n            onOptionsChange({ ...options, ignorePatterns: patterns });\n          }}\n          disabled={disabled}\n        />\n        <small>Comma-separated list of patterns</small>\n      </FormGroup>\n\n      <FormGroup>\n        <Label>File Operations:</Label>\n        <Label htmlFor="allowFileCreate">\n          <input\n            type="checkbox"\n            id="allowFileCreate"\n            name="allowFileCreate"\n            checked={options.allowFileCreate !== false}\n            onChange={handleChange}\n            disabled={disabled}\n          />\n          Allow File Create\n        </Label>\n        <Label htmlFor="allowFileDelete">\n          <input\n            type="checkbox"\n            id="allowFileDelete"\n            name="allowFileDelete"\n            checked={options.allowFileDelete !== false}\n            onChange={handleChange}\n            disabled={disabled}\n          />\n          Allow File Delete\n        </Label>\n        <Label htmlFor="allowDirectoryCreate">\n          <input\n            type="checkbox"\n            id="allowDirectoryCreate"\n            name="allowDirectoryCreate"\n            checked={options.allowDirectoryCreate !== false}\n            onChange={handleChange}\n            disabled={disabled}\n          />\n          Allow Directory Create\n        </Label>\n        <Label htmlFor="allowFileMove">\n          <input\n            type="checkbox"\n            id="allowFileMove"\n            name="allowFileMove"\n            checked={options.allowFileMove !== false}\n            onChange={handleChange}\n            disabled={disabled}\n          />\n          Allow File Move\n        </Label>\n      </FormGroup>\n    </FormContainer>\n  );\n};\n\nconst FormContainer = styled.div`\n  background-color: ${(props) => props.theme.colors.backgroundSecondary};\n  border: 1px solid ${(props) => props.theme.colors.border};\n  border-radius: 4px;\n  padding: 16px;\n  margin-top: 16px;\n`;\n\nconst FormGroup = styled.div`\n  margin-bottom: 16px;\n`;\n\nconst Label = styled.label`\n  display: block;\n  margin-bottom: 4px;\n  color: ${(props) => props.theme.colors.text};\n`;\n\nconst Input = styled.input`\n  width: 100%;\n  padding: 8px;\n  border: 1px solid ${(props) => props.theme.colors.border};\n  border-radius: 4px;\n  background-color: ${(props) => props.theme.colors.inputBg};\n  color: ${(props) => props.theme.colors.inputText};\n\n  &:disabled {\n    background-color: ${(props) => props.theme.colors.disabled};\n    cursor: not-allowed;\n  }\n`;\n',
            },
            'image-upload.tsx': { summary: 'Handles the upload and preview of images for the input area.' },
            'input-area.tsx': {
              summary:
                'Renders the input area, including the textarea, image upload, buttons, and codegen options form.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app': {
            'genaicode-app.tsx': { summary: 'Main application component that orchestrates the UI' },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/hooks': {
            'merged-messages.ts': {
              summary:
                'Provides a custom hook to merge chat messages into iterations, including system messages and conversation summaries.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/theme': {
            'global-style.ts': {
              summary:
                'Defines the global styles for the application, including the background image and color scheme.',
            },
            'styled-components.d.ts': { summary: 'Type definitions for styled-components.' },
            'theme.ts': {
              summary:
                'Defines the light and dark themes for the application, including the color scheme and background image.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/main/ui/frontend': {
            'index.html': {
              summary: 'Defines the HTML structure of the application, including the root element and script import.',
            },
            'index.js': { summary: 'Renders the main application component to the DOM.' },
            'tsconfig.json': { summary: 'Defines the TypeScript configuration for the frontend application.' },
            'vite-env.d.ts': { summary: 'Provides type definitions for the Vite environment.' },
          },
          '/Users/gtanczyk/src/codegen/src/operations/create-directory': {
            'create-directory-def.ts': { summary: 'Defines the function definition for creating a new directory.' },
            'create-directory-executor.ts': { summary: 'Implements the logic for creating a new directory.' },
          },
          '/Users/gtanczyk/src/codegen/src/operations/create-file': {
            'create-file-def.ts': { summary: 'Defines the function definition for creating a new file.' },
            'create-file-executor.ts': { summary: 'Implements the logic for creating a new file.' },
          },
          '/Users/gtanczyk/src/codegen/src/operations/delete-file': {
            'delete-file-def.ts': { summary: 'Defines the function definition for deleting a file.' },
            'delete-file-executor.ts': { summary: 'Implements the logic for deleting a file.' },
          },
          '/Users/gtanczyk/src/codegen/src/operations/download-file': {
            'download-file-def.ts': { summary: 'Defines the function definition for downloading a file.' },
            'download-file-executor.ts': { summary: 'Implements the logic for downloading a file.' },
          },
          '/Users/gtanczyk/src/codegen/src/operations/imgly-remove-background': {
            'imgly-remove-background-def.ts': {
              summary:
                'Defines the function definition for removing the background from an image using the @imgly/background-removal-node library.',
            },
            'imgly-remove-background-executor.ts': {
              summary:
                'Implements the logic for removing the background from an image using the @imgly/background-removal-node library.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/operations/move-file': {
            'move-file-def.ts': {
              summary: 'Defines the function definition for moving a file from one location to another.',
            },
            'move-file-executor.ts': {
              summary: 'Implements the logic for moving a file from one location to another.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/operations': {
            'operations-index.ts': {
              summary:
                'Provides a centralized index of all available operations, including their executors and definitions.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/operations/patch-file': {
            'patch-file-def.ts': {
              summary: "Defines the function definition for partially updating a file's content.",
            },
            'patch-file-executor.ts': { summary: "Implements the logic for partially updating a file's content." },
          },
          '/Users/gtanczyk/src/codegen/src/operations/resize-image': {
            'resize-image-def.ts': {
              summary: 'Defines the function definition for resizing an image to a specified size.',
            },
            'resize-image-executor.ts': { summary: 'Implements the logic for resizing an image to a specified size.' },
          },
          '/Users/gtanczyk/src/codegen/src/operations/split-image': {
            'split-image-def.ts': {
              summary: 'Defines function to split image into multiple parts and save them as separate files.',
            },
            'split-image-executor.ts': {
              summary: 'Implements function to split image into multiple parts and save them as separate files.',
            },
          },
          '/Users/gtanczyk/src/codegen/src/operations/update-file': {
            'update-file-def.ts': { summary: 'Defines function to update a file with new content.' },
            'update-file-executor.ts': { summary: 'Implements function to update a file with new content.' },
          },
          '/Users/gtanczyk/src/codegen/src/prompt': {
            'ai-service-fallback.ts': { summary: 'Handles AI service fallback when rate limit is exceeded.' },
            'function-calling-validate.ts': {
              summary: 'Validates function calls to ensure they match the expected schema.',
            },
            'function-calling.ts': { summary: 'Defines function definitions for function calling.' },
            'limits.test.ts': { summary: 'Tests for prompt and source code token limits.' },
            'limits.ts': { summary: 'Defines functions to verify prompt and source code token limits.' },
            'prompt-codegen.test.ts': { summary: 'Tests for code generation prompt and lint fix prompt.' },
            'prompt-codegen.ts': { summary: 'Generates code generation prompt and lint fix prompt.' },
            'prompt-consts.ts': { summary: 'Defines a constant for the code generation trigger.' },
            'prompt-service-ask-question.test.ts': { summary: 'Tests the prompt service with askQuestion feature.' },
            'prompt-service.test.ts': { summary: 'Tests for the prompt service.' },
            'prompt-service.ts': {
              summary: 'Implements promptService function that handles code generation prompts and responses.',
            },
            'systemprompt.test.ts': { summary: 'Tests for the system prompt.' },
            'systemprompt.ts': {
              summary:
                'Generates system prompt for the code generation assistant, defines guidelines and usage of key functions',
            },
            'token-estimator.ts': { summary: 'Estimates token count for text and code.' },
          },
          '/Users/gtanczyk/src/codegen/src/prompt/function-defs': {
            'ask-question.ts': {
              summary:
                'Defines askQuestion function for interactions, managing conversation flow and requesting information.',
            },
            'codegen-summary.ts': { summary: 'Defines function to summarize proposed code generation updates.' },
            'explanation.ts': { summary: 'Defines function to explain the reasoning behind code changes.' },
            'generate-image.ts': { summary: 'Defines function to generate images using AI service.' },
            'get-image-assets.ts': { summary: 'Defines function to get a map of application image assets.' },
            'get-source-code.ts': { summary: 'Defines function definition for getSourceCode.' },
            'optimize-context.ts': {
              summary: 'Defines optimizeContext function: prioritizes code files based on relevance to user prompt.',
            },
            'read-history.ts': { summary: 'Defines function to read the conversation history.' },
            'set-summaries.ts': { summary: 'Defines function to save summaries of files.' },
            'update-history.ts': { summary: 'Defines function to update the conversation history.' },
          },
          '/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question/handlers': {
            'cancel-code-generation.ts': { summary: 'Handles the cancellation of code generation.' },
            'confirm-code-generation.ts': { summary: 'Handles confirmation of code generation.' },
            'context-optimization.ts': { summary: 'Handles context optimization' },
            'default-action.ts': { summary: 'Default action handler' },
            'handle-request-answer-with-image.ts': { summary: 'Handles image generation requests' },
            'handle-request-answer.ts': { summary: 'Handles answer requests' },
            'remove-files-from-context.ts': { summary: 'Removes files from context' },
            'request-files-content.ts': { summary: 'Requests file content' },
            'request-permissions.ts': { summary: 'Handles permission requests' },
            'start-code-generation.ts': { summary: 'Handles the start of code generation.' },
          },
          '/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question': {
            'step-ask-question-types.ts': { summary: 'Defines types for the step-ask-question feature.' },
            'step-ask-question.ts': { summary: 'Implements the step-ask-question feature.' },
          },
          '/Users/gtanczyk/src/codegen/src/prompt/steps': {
            'step-context-optimization.test.ts': { summary: 'Unit tests for context optimization step.' },
            'step-context-optimization.ts': {
              summary: 'Optimizes context for code generation by evaluating file relevance and token cost.',
            },
            'step-generate-image.ts': { summary: 'Implements the step to generate images using AI service.' },
            'step-generate-summary.ts': { summary: 'Implements the step to generate a summary of the conversation.' },
            'step-history-update.ts': { summary: 'Implements the step to update the conversation history.' },
            'step-summarization.ts': { summary: 'Summarizes source code files and caches the summaries.' },
            'step-validate-recover.ts': { summary: 'Validates and recovers function calls' },
            'step-verify-patch.ts': { summary: 'Implements the step to verify the validity of a patch file.' },
            'steps-types.ts': { summary: 'Defines types for the prompt service steps.' },
            'steps-utils.ts': { summary: 'Provides utility functions for the prompt service steps.' },
          },
          '/Users/gtanczyk/src/codegen/src/vite-genaicode': {
            'README.md': { summary: 'Docs for Vite plugin that integrates GenAIcode into dev workflow.' },
            'tsconfig.json': { summary: 'TypeScript config for Vite GenAIcode plugin.' },
            'vite-env.d.ts': { summary: 'TypeScript type definitions for Vite environment.' },
            'vite-genaicode-frontend.ts': { summary: 'Custom element for GenAICode overlay in Vite plugin.' },
            'vite-genaicode-plugin.ts': { summary: 'Vite plugin for integrating GenAIcode into a Vite-based project.' },
          },
        }),
      },
      {
        name: 'readHistory',
        content:
          "24-10: ops, refact, perms, CG start. 21: plugin cfg, dyn load, svc; core/cfg/func-call upd; ops, self-reflect. 21: plugin sys init, new loader, cfg/codegen upd, opt hist. 22: 'nonsense', '--ai-service' CLI, gen code. 22: tst, clarif req, conf/summ CG, opt ctx. 22: task: hello; anlys, clarif, conf CG, CG summ, opt ctx, CG, comp. 22: plugin ext ActionTypes, custom acts. 22: anlyz Anthropic genCont, fix cache, patch. 22: upd ask-question, plugin acts. 26: img disp, upd ChatMsg. 27: 'requestAnswerWithImg', img gen req. 28: anlyz getSourceCodeTree, gen summ, conf/opt CG, comp. 28-10: test step-context-opt: 1)src 2)opt 3)edge 4)token. 29: upd test, verify step-context-opt. 29: AI svc select, save backend. 30: upd cfg/svc. 30: opt opts, retain ctx. 30: add QuestionHandler opts. 30-10: sync aiSvc in QHandler. 2024-11-01: upd self-reflect: cheap/exp, 4-step, err, esc. Summ CG: exp, files, ctx. Clarif: tasks, goals, constraints, timeline. 2024-11-01: upd step-ask-question-reflect.ts self-reflect prompt: 1)balanced, concise 2)separate const 3)structure, examples. 2024-11-01T12:13:58.980Z: Fixed test: src/prompt/prompt-service-ask-question.test.ts > promptService with askQuestion > should handle self-reflection mechanism. Updated prompt-service.ts to include self-reflection calls after each askQuestion call. Updated test to reflect changes in generateContent calls. 7 calls expected. 2024-11-01T12:25:15.193Z: Analyzed task to fix test in src/prompt/prompt-service-ask-question.test.ts where expected 7 calls; got 6. Confirmed code generation to update test code and ensure expected behavior. Generated code updates and context for image assets.",
      },
    ],
    cache: true,
    text: 'I should also provide you with a summary of application image assets',
  },
  {
    type: 'assistant',
    text: 'Please provide summary of application image assets.',
    functionCalls: [
      {
        name: 'getImageAssets',
      },
    ],
  },
  {
    type: 'user',
    functionResponses: [
      {
        name: 'getImageAssets',
        content:
          '{"/Users/gtanczyk/src/codegen/media/logo-dark.png":{"mimeType":"image/png","width":1200,"height":686},"/Users/gtanczyk/src/codegen/media/logo.png":{"mimeType":"image/png","width":1200,"height":686},"/Users/gtanczyk/src/codegen/src/vite-genaicode/media/demo-for-readme.gif":{"mimeType":"image/gif","width":769,"height":465}}',
      },
    ],
    text: 'I want the ai service selector also have checkbox for cheap/non-cheap, and I want this setting to be propagated the same way as we currently propagate the aiService setting. Request files content if you think it is useful for analysis',
  },
];

export const DEBUG_PROMPT_3 = [
  ...DEBUG_PROMPT_1,
  {
    type: 'assistant',
    text: 'To implement the AI service selector with a checkbox for cheap/non-cheap mode, I will need to analyze the existing implementation and make the necessary changes. Can you please provide more details on the desired behavior and how this setting should be propagated?',
    functionCalls: [
      {
        id: 'toolu_0187VNzvnGgUPyhCwEzkX9j6',
        name: 'askQuestion',
        args: {
          actionType: 'requestAnswer',
          content:
            'To implement the AI service selector with a checkbox for cheap/non-cheap mode, I will need to analyze the existing implementation and make the necessary changes. Can you please provide more details on the desired behavior and how this setting should be propagated?',
        },
      },
    ],
  },
  {
    type: 'user',
    text: 'see ask question step action handlers: handle request answer, and confirm code generation, thats where we consume the aiService selection. I want the same for cheap setting. Please analyze this e2e',
    functionResponses: [
      {
        name: 'askQuestion',
        call_id: 'toolu_0187VNzvnGgUPyhCwEzkX9j6',
        content: undefined,
      },
    ],
  },
];

export const DEBUG_PROMPT_4 = [
  ...DEBUG_PROMPT_3,
  {
    type: 'assistant',
    text: 'Understood, let me analyze the existing implementation of the AI service selector and how the cheap setting is handled end-to-end.',
    functionCalls: [
      {
        id: 'toolu_01KDEWgfieoa21YfATdEq8bk',
        name: 'askQuestion',
        args: {
          actionType: 'requestAnswer',
          content:
            'Understood, let me analyze the existing implementation of the AI service selector and how the cheap setting is handled end-to-end.',
        },
      },
    ],
  },
  {
    type: 'user',
    text: 'ok',
    functionResponses: [
      {
        name: 'askQuestion',
        call_id: 'toolu_01KDEWgfieoa21YfATdEq8bk',
        content: undefined,
      },
    ],
  },
];

export const DEBUG_PROMPT_5 = [
  ...DEBUG_PROMPT_4,
  {
    type: 'assistant',
    text: 'To implement the AI service selector with a checkbox for cheap/non-cheap mode, I will need to analyze the existing implementation and make the necessary changes. Can you please provide more details on the desired behavior and how this setting should be propagated?',
    functionCalls: [
      {
        id: 'toolu_018SyLw5EMP5AueQNKXxopGA',
        name: 'askQuestion',
        args: {
          actionType: 'requestAnswer',
          content:
            'To implement the AI service selector with a checkbox for cheap/non-cheap mode, I will need to analyze the existing implementation and make the necessary changes. Can you please provide more details on the desired behavior and how this setting should be propagated?',
        },
      },
    ],
  },
  {
    type: 'user',
    text: 'yes',
    functionResponses: [
      {
        name: 'askQuestion',
        call_id: 'toolu_018SyLw5EMP5AueQNKXxopGA',
        content: undefined,
      },
    ],
  },
];

export const DEBUG_PROMPT_6 = [
  ...DEBUG_PROMPT_5,
  {
    type: 'assistant',
    text: 'Understood. Let me analyze the existing implementation of the AI service selector and how the cheap setting is handled end-to-end.',
    functionCalls: [
      {
        id: 'toolu_01GnHNCsPmngqyHgQ4FFN8tS',
        name: 'askQuestion',
        args: {
          actionType: 'requestAnswer',
          content:
            'Understood. Let me analyze the existing implementation of the AI service selector and how the cheap setting is handled end-to-end.',
        },
      },
    ],
  },
  {
    type: 'user',
    text: 'ok',
    functionResponses: [
      {
        name: 'askQuestion',
        call_id: 'toolu_01GnHNCsPmngqyHgQ4FFN8tS',
        content: undefined,
      },
    ],
  },
];

export const DEBUG_PROMPT_7 = [
  ...DEBUG_PROMPT_6,
  {
    type: 'assistant',
    text: 'I need to analyze the implementation of AI service selector and how it integrates with the ask question handlers. Please provide the content of these files.',
    functionCalls: [
      {
        id: 'toolu_014XtmmG5Q6v1iGcFAQDfg7G',
        name: 'askQuestion',
        args: {
          actionType: 'requestFilesContent',
          content:
            'I need to analyze the implementation of AI service selector and how it integrates with the ask question handlers. Please provide the content of these files.',
          requestFilesContent: [
            '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/components/input-area/ai-service-selector.tsx',
            '/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question/handlers/handle-request-answer.ts',
            '/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question/handlers/confirm-code-generation.ts',
          ],
        },
      },
      {
        name: 'getSourceCode',
        id: 'toolu_014XtmmG5Q6v1iGcFAQDfg7G_source',
        args: {
          filePaths: [
            '/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/components/input-area/ai-service-selector.tsx',
            '/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question/handlers/handle-request-answer.ts',
            '/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question/handlers/confirm-code-generation.ts',
          ],
        },
      },
    ],
  },
  {
    type: 'user',
    text: 'All requested file contents have been provided.',
    functionResponses: [
      {
        name: 'askQuestion',
        call_id: 'toolu_014XtmmG5Q6v1iGcFAQDfg7G',
        content: undefined,
      },
      {
        name: 'getSourceCode',
        call_id: 'toolu_014XtmmG5Q6v1iGcFAQDfg7G_source',
        content:
          "{\"/Users/gtanczyk/src/codegen/src/main/codegen-types.ts\":{\"content\":\"import { FunctionDef, GenerateContentFunction } from '../ai-service/common';\\nimport { ActionHandler } from '../prompt/steps/step-ask-question/step-ask-question-types';\\n\\n/** Example: {@link ../../examples/genaicode_plugins/grok_ai_service.ts} */\\nexport type PluginAiServiceType = `plugin:${string}`;\\n\\n/** Example: {@link ../../examples/genaicode_plugins/nonsense_action_handlers.ts} */\\nexport type PluginActionType = `plugin:${string}`;\\n\\nexport type AiServiceType =\\n  | 'vertex-ai'\\n  | 'ai-studio'\\n  | 'vertex-ai-claude'\\n  | 'chat-gpt'\\n  | 'anthropic'\\n  | PluginAiServiceType;\\n\\nexport type ImagenType = 'vertex-ai' | 'dall-e';\\n\\nexport interface UploadedImage {\\n  base64url: string;\\n  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';\\n  originalName: string;\\n}\\n\\nexport interface CodegenOptions {\\n  explicitPrompt?: string;\\n  taskFile?: string;\\n  considerAllFiles?: boolean;\\n  allowFileCreate?: boolean;\\n  allowFileDelete?: boolean;\\n  allowDirectoryCreate?: boolean;\\n  allowFileMove?: boolean;\\n  vision?: boolean;\\n  imagen?: ImagenType;\\n  aiService: AiServiceType;\\n\\n  disableContextOptimization?: boolean;\\n  temperature?: number;\\n  cheap?: boolean;\\n  dryRun?: boolean;\\n  verbose?: boolean;\\n  requireExplanations?: boolean;\\n  geminiBlockNone?: boolean;\\n  disableInitialLint?: boolean;\\n  contentMask?: string;\\n  ignorePatterns?: string[];\\n  askQuestion?: boolean;\\n  interactive?: boolean;\\n  ui?: boolean;\\n  uiPort?: number;\\n  uiFrameAncestors?: string[];\\n  disableCache?: boolean;\\n  dependencyTree?: boolean;\\n  historyEnabled?: boolean;\\n\\n  disableAiServiceFallback?: boolean;\\n  conversationSummaryEnabled?: boolean;\\n  images?: UploadedImage[];\\n  isDev?: boolean;\\n}\\n\\ninterface ExecutorArgs {\\n  [key: string]: unknown;\\n}\\n\\nexport type OperationExecutor = (args: ExecutorArgs, options: CodegenOptions) => Promise<void>;\\n\\nexport type Operation = {\\n  executor: OperationExecutor;\\n  def: FunctionDef;\\n};\\n\\nexport interface Plugin {\\n  name: string;\\n  aiServices?: Record<string, GenerateContentFunction>;\\n  operations?: Record<string, Operation>;\\n  actionHandlers?: Record<\\n    string,\\n    {\\n      /** The action handler implementation */\\n      handler: ActionHandler;\\n      /**\\n       * Description of what this action handler does.\\n       * This description will be included in the askQuestion function definition\\n       * to help the AI understand when to use this action.\\n       */\\n      description: string;\\n    }\\n  >;\\n}\\n\"},\"/Users/gtanczyk/src/codegen/src/main/codegen.ts\":{\"content\":\"import { exec } from 'child_process';\\nimport util from 'util';\\n\\nimport * as cliParams from '../cli/cli-params.js';\\nimport { validateCliParams } from '../cli/validate-cli-params.js';\\nimport { generateContent as generateContentVertexAi } from '../ai-service/vertex-ai.js';\\nimport { generateContent as generateContentGPT } from '../ai-service/chat-gpt.js';\\nimport { generateContent as generateContentAnthropic } from '../ai-service/anthropic.js';\\nimport { generateContent as generateContentVertexAiClaude } from '../ai-service/vertex-ai-claude.js';\\nimport { generateContent as generateContentAiStudio } from '../ai-service/ai-studio.js';\\nimport { generateImage as generateImageDallE } from '../ai-service/dall-e.js';\\nimport { generateImage as generateImageVertexAi } from '../ai-service/vertex-ai-imagen.js';\\n\\nimport { promptService } from '../prompt/prompt-service.js';\\nimport { updateFiles } from '../files/update-files.js';\\nimport { rcConfig } from '../main/config.js';\\nimport { AiServiceType, CodegenOptions, ImagenType } from './codegen-types.js';\\nimport { getLintFixPrompt } from '../prompt/prompt-codegen.js';\\nimport { printHelpMessage } from '../cli/cli-options.js';\\nimport { FunctionCall, GenerateContentFunction, GenerateImageFunction } from '../ai-service/common.js';\\nimport { getCodeGenPrompt } from '../prompt/prompt-codegen.js';\\n\\nimport { runInteractiveMode } from './interactive/codegen-interactive.js';\\nimport { runCodegenUI } from './ui/codegen-ui.js';\\nimport {\\n  putSystemMessage,\\n  putUserMessage,\\n  setCurrentIterationId,\\n  unsetCurrentIterationId,\\n} from './common/content-bus.js';\\nimport { refreshFiles } from '../files/find-files.js';\\nimport { getRegisteredAiServices } from './plugin-loader.js';\\nimport { stringToAiServiceType } from './codegen-utils.js';\\n\\n/** Executes codegen */\\nexport async function runCodegen(isDev = false): Promise<void> {\\n  // Print to console the received parameters\\n  console.log(`Received parameters: ${process.argv.slice(2).join(' ')}`);\\n\\n  validateCliParams();\\n\\n  // Handle --help option\\n  if (cliParams.helpRequested) {\\n    printHelpMessage();\\n    return;\\n  }\\n\\n  const options: CodegenOptions = {\\n    explicitPrompt: cliParams.explicitPrompt,\\n    taskFile: cliParams.taskFile,\\n    considerAllFiles: cliParams.considerAllFiles,\\n    dependencyTree: cliParams.dependencyTree,\\n\\n    allowFileCreate: cliParams.allowFileCreate,\\n    allowFileDelete: cliParams.allowFileDelete,\\n    allowDirectoryCreate: cliParams.allowDirectoryCreate,\\n    allowFileMove: cliParams.allowFileMove,\\n\\n    aiService: stringToAiServiceType(cliParams.aiService),\\n    vision: cliParams.vision,\\n    imagen: cliParams.imagen,\\n\\n    disableContextOptimization: cliParams.disableContextOptimization,\\n    temperature: cliParams.temperature,\\n    cheap: cliParams.cheap,\\n    dryRun: cliParams.dryRun,\\n    verbose: cliParams.verbosePrompt,\\n    requireExplanations: !cliParams.disableExplanations,\\n    geminiBlockNone: cliParams.geminiBlockNone,\\n    disableInitialLint: cliParams.disableInitialLint,\\n    contentMask: cliParams.contentMask,\\n    ignorePatterns: cliParams.ignorePatterns,\\n    askQuestion: cliParams.askQuestion,\\n    disableCache: cliParams.disableCache,\\n    interactive: cliParams.interactive,\\n    ui: cliParams.ui,\\n    uiPort: cliParams.uiPort,\\n    disableAiServiceFallback: cliParams.disableAiServiceFallback,\\n    historyEnabled: !cliParams.disableHistory,\\n    conversationSummaryEnabled: !cliParams.disableConversationSummary,\\n\\n    isDev,\\n  };\\n\\n  if (cliParams.ui) {\\n    await runCodegenUI(options);\\n  } else if (cliParams.interactive) {\\n    // Handle interactive mode\\n    await runInteractiveMode(options);\\n  } else {\\n    console.log('Executing codegen in non-interactive mode');\\n    await runCodegenIteration(options);\\n  }\\n}\\n\\nexport async function runCodegenIteration(\\n  options: CodegenOptions,\\n  abortSignal?: AbortSignal,\\n  waitIfPaused: () => Promise<void> = () => Promise.resolve(),\\n) {\\n  refreshFiles();\\n\\n  setCurrentIterationId();\\n\\n  putUserMessage(\\n    options.explicitPrompt ?? options.taskFile ?? 'Run codegen iteration without explicit prompt.',\\n    undefined,\\n    undefined,\\n    options.images,\\n  );\\n\\n  if (rcConfig.lintCommand && !options.disableInitialLint) {\\n    try {\\n      putSystemMessage(`Executing lint command: ${rcConfig.lintCommand}`);\\n      await execPromise(rcConfig.lintCommand, { cwd: rcConfig.rootDir });\\n      putSystemMessage('Lint command executed successfully');\\n    } catch (error) {\\n      const { stderr, stdout } = error as { stdout: string; stderr: string };\\n      putSystemMessage(\\n        'Lint command failed. Aborting codegen, please fix lint issues before running codegen, or use --disable-initial-lint',\\n      );\\n      console.log('Lint errors:', stdout, stderr);\\n      unsetCurrentIterationId();\\n      return;\\n    }\\n  } else if (rcConfig.lintCommand && options.disableInitialLint) {\\n    console.log('Initial lint was skipped.');\\n  }\\n\\n  if (abortSignal?.aborted) {\\n    unsetCurrentIterationId();\\n    throw new Error('Codegen iteration aborted');\\n  }\\n\\n  await waitIfPaused();\\n\\n  putSystemMessage('Generating response');\\n  try {\\n    const functionCalls = await promptService(\\n      getGenerateContentFunctions(),\\n      GENERATE_IMAGE_FNS,\\n      getCodeGenPrompt(options),\\n      waitIfPaused,\\n    );\\n    console.log('Received function calls:', functionCalls);\\n\\n    await waitIfPaused();\\n\\n    if (functionCalls.length === 0) {\\n      putSystemMessage('No updates to apply');\\n    } else if (options.dryRun) {\\n      putSystemMessage('Dry run mode, not updating files');\\n    } else {\\n      putSystemMessage('Update files');\\n      await updateFiles(\\n        functionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),\\n        options,\\n      );\\n      putSystemMessage('Initial updates applied');\\n\\n      if (abortSignal?.aborted) {\\n        throw new Error('Codegen iteration aborted after initial updates');\\n      }\\n\\n      await waitIfPaused();\\n\\n      // Check if lintCommand is specified in .genaicoderc\\n      if (rcConfig.lintCommand && functionCalls.length > 0) {\\n        try {\\n          putSystemMessage(`Executing lint command: ${rcConfig.lintCommand}`);\\n          await execPromise(rcConfig.lintCommand, { cwd: rcConfig.rootDir });\\n          putSystemMessage('Lint command executed successfully');\\n        } catch (error) {\\n          putSystemMessage('Lint command failed. Attempting to fix issues...');\\n\\n          // Prepare the lint error output for the second pass\\n          const firstLintError = error as { stdout: string; stderr: string };\\n          const lintErrorPrompt = getLintFixPrompt(\\n            rcConfig.lintCommand,\\n            options,\\n            firstLintError.stdout,\\n            firstLintError.stderr,\\n          );\\n\\n          putSystemMessage('Generating response for lint fixes');\\n          const lintFixFunctionCalls = (await promptService(\\n            getGenerateContentFunctions(),\\n            GENERATE_IMAGE_FNS,\\n            {\\n              prompt: lintErrorPrompt,\\n              options: { ...options, considerAllFiles: true },\\n            },\\n            waitIfPaused,\\n          )) as FunctionCall[];\\n\\n          console.log('Received function calls for lint fixes:', lintFixFunctionCalls);\\n\\n          await waitIfPaused();\\n\\n          putSystemMessage('Applying lint fixes');\\n          updateFiles(\\n            lintFixFunctionCalls.filter((call) => call.name !== 'explanation' && call.name !== 'getSourceCode'),\\n            options,\\n          );\\n\\n          if (abortSignal?.aborted) {\\n            throw new Error('Codegen iteration aborted after lint fixes');\\n          }\\n\\n          // Run lint command again to verify fixes\\n          try {\\n            putSystemMessage(`Re-running lint command: ${rcConfig.lintCommand}`);\\n            await execPromise(rcConfig.lintCommand);\\n            putSystemMessage('Lint command executed successfully after fixes');\\n          } catch (secondLintError) {\\n            const error = secondLintError as { stdout: string; stderr: string };\\n            putSystemMessage('Lint command still failing after fixes. Manual intervention may be required.');\\n            console.log('Lint errors:', error.stdout, error.stderr);\\n          }\\n        }\\n      }\\n\\n      console.log('Done!');\\n    }\\n  } catch (error) {\\n    if (error instanceof Error) {\\n      if (error.name === 'AbortError' || error.message.includes('interrupted')) {\\n        putSystemMessage('Codegen iteration was interrupted');\\n      } else if (error.message.includes('Rate limit exceeded')) {\\n        putSystemMessage(\\n          'Rate limit exceeded. Consider switching to a different AI service or waiting before retrying.',\\n        );\\n      } else {\\n        putSystemMessage(`An error occurred during codegen: ${error.message}`);\\n      }\\n    } else {\\n      putSystemMessage('An unknown error occurred during codegen');\\n    }\\n    console.error('Error details:', error);\\n  } finally {\\n    unsetCurrentIterationId();\\n  }\\n}\\n\\n// helper functions and consts\\n\\nconst execPromise = util.promisify(exec);\\n\\nfunction getGenerateContentFunctions(): Record<AiServiceType, GenerateContentFunction> {\\n  return {\\n    'vertex-ai-claude': generateContentVertexAiClaude,\\n    'vertex-ai': generateContentVertexAi,\\n    'ai-studio': generateContentAiStudio,\\n    anthropic: generateContentAnthropic,\\n    'chat-gpt': generateContentGPT,\\n    ...Object.fromEntries(getRegisteredAiServices().entries()),\\n  };\\n}\\n\\nconst GENERATE_IMAGE_FNS: Record<ImagenType, GenerateImageFunction> = {\\n  'dall-e': generateImageDallE,\\n  'vertex-ai': generateImageVertexAi,\\n} as const;\\n\"},\"/Users/gtanczyk/src/codegen/src/main/ui/frontend/app/components/input-area/ai-service-selector.tsx\":{\"content\":\"import React, { useState, useEffect } from 'react';\\nimport styled from 'styled-components';\\nimport { AiServiceType } from '../../../../../codegen-types';\\nimport { getAvailableAiServices } from '../../api/api-client';\\n\\ninterface AiServiceSelectorProps {\\n  value: AiServiceType;\\n  onChange: (value: AiServiceType) => void;\\n  disabled?: boolean;\\n}\\n\\nexport const AiServiceSelector: React.FC<AiServiceSelectorProps> = ({ value, onChange, disabled }) => {\\n  const [availableServices, setAvailableServices] = useState<AiServiceType[]>([]);\\n  const [error, setError] = useState<string | null>(null);\\n\\n  useEffect(() => {\\n    const fetchAiServices = async () => {\\n      try {\\n        const services = await getAvailableAiServices();\\n        setAvailableServices(services);\\n      } catch (err) {\\n        console.error('Error fetching AI services:', err);\\n        setError('Failed to fetch available AI services.');\\n      }\\n    };\\n\\n    fetchAiServices();\\n  }, []);\\n\\n  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {\\n    onChange(event.target.value as AiServiceType);\\n  };\\n\\n  return (\\n    <Container>\\n      <Select id=\\\"aiService\\\" value={value} onChange={handleChange} disabled={disabled || error !== null}>\\n        <option value=\\\"\\\">Select AI Service</option>\\n        {availableServices.map((service) => (\\n          <option key={service} value={service}>\\n            {service}\\n          </option>\\n        ))}\\n      </Select>\\n      {error && <ErrorMessage>{error}</ErrorMessage>}\\n    </Container>\\n  );\\n};\\n\\nconst Container = styled.div`\\n  display: flex;\\n  flex-direction: column;\\n  gap: 4px;\\n`;\\n\\nconst Select = styled.select`\\n  padding: 8px;\\n  border: 1px solid ${({ theme }) => theme.colors.border};\\n  border-radius: 4px;\\n  background-color: ${({ theme }) => theme.colors.inputBg};\\n  color: ${({ theme }) => theme.colors.inputText};\\n  font-size: 14px;\\n\\n  &:disabled {\\n    background-color: ${({ theme }) => theme.colors.disabled};\\n    cursor: not-allowed;\\n  }\\n`;\\n\\nconst ErrorMessage = styled.div`\\n  color: ${({ theme }) => theme.colors.error};\\n  font-size: 14px;\\n`;\\n\"},\"/Users/gtanczyk/src/codegen/src/prompt/prompt-service.ts\":{\"content\":\"import assert from 'node:assert';\\nimport fs from 'fs';\\nimport mime from 'mime-types';\\n\\nimport { getSystemPrompt } from './systemprompt.js';\\nimport { getFunctionDefs } from './function-calling.js';\\nimport { getSourceCode, getImageAssets } from '../files/read-files.js';\\nimport {\\n  PromptItem,\\n  FunctionDef,\\n  FunctionCall,\\n  GenerateContentFunction,\\n  GenerateImageFunction,\\n} from '../ai-service/common.js';\\nimport { importantContext } from '../main/config.js';\\nimport { AiServiceType, CodegenOptions, ImagenType } from '../main/codegen-types.js';\\nimport { executeStepAskQuestion } from './steps/step-ask-question/step-ask-question.js';\\nimport { validateAndRecoverSingleResult } from './steps/step-validate-recover.js';\\nimport { executeStepVerifyPatch } from './steps/step-verify-patch.js';\\nimport { executeStepGenerateImage } from './steps/step-generate-image.js';\\nimport { executeStepContextOptimization } from './steps/step-context-optimization.js';\\nimport { StepResult } from './steps/steps-types.js';\\nimport { CodegenPrompt } from './prompt-codegen.js';\\nimport { putSystemMessage } from '../main/common/content-bus.js';\\nimport { handleAiServiceFallback } from './ai-service-fallback.js';\\nimport { summarizeSourceCode } from './steps/step-summarization.js';\\nimport { executeStepHistoryUpdate, getCurrentHistory } from './steps/step-history-update.js';\\nimport { executeStepGenerateSummary } from './steps/step-generate-summary.js';\\nimport { getSourceCodeTree } from '../files/source-code-tree.js';\\n\\n/** A function that communicates with model using */\\nexport async function promptService(\\n  generateContentFns: Record<AiServiceType, GenerateContentFunction>,\\n  generateImageFns: Record<ImagenType, GenerateImageFunction>,\\n  codegenPrompt: CodegenPrompt,\\n  waitIfPaused: () => Promise<void> = () => Promise.resolve(),\\n): Promise<FunctionCall[]> {\\n  const generateContentFn: GenerateContentFunction = async (...args) => {\\n    return await handleAiServiceFallback(\\n      generateContentFns,\\n      codegenPrompt.options.aiService,\\n      codegenPrompt.options,\\n      ...args,\\n    );\\n  };\\n\\n  const generateImageFn: GenerateImageFunction = (...args) => {\\n    assert(codegenPrompt.options.imagen, 'imagen value must be provided');\\n    return generateImageFns[codegenPrompt.options.imagen](...args);\\n  };\\n\\n  const { result, prompt } = await executePromptService(\\n    generateContentFn,\\n    generateImageFn,\\n    codegenPrompt,\\n    waitIfPaused,\\n  );\\n\\n  if (codegenPrompt.options.historyEnabled) {\\n    await executeStepHistoryUpdate(generateContentFn, prompt, codegenPrompt.options);\\n  }\\n\\n  return result;\\n}\\n\\nasync function executePromptService(\\n  generateContentFn: GenerateContentFunction,\\n  generateImageFn: GenerateImageFunction,\\n  codegenPrompt: CodegenPrompt,\\n  waitIfPaused: () => Promise<void> = () => Promise.resolve(),\\n): Promise<{ result: FunctionCall[]; prompt: PromptItem[] }> {\\n  const messages = prepareMessages(codegenPrompt);\\n\\n  // First stage: summarize the source code\\n  if (!codegenPrompt.options.disableContextOptimization) {\\n    await summarizeSourceCode(\\n      generateContentFn,\\n      getSourceCode({ forceAll: true }, codegenPrompt.options),\\n      codegenPrompt.options,\\n    );\\n  }\\n\\n  // Second stage: generate code generation summary, which should not take a lot of output tokens\\n  const getSourceCodeRequest: FunctionCall = { name: 'getSourceCode' };\\n\\n  const prompt: PromptItem[] = [\\n    { type: 'systemPrompt', systemPrompt: getSystemPrompt(codegenPrompt.options) },\\n    { type: 'user', text: messages.suggestSourceCode },\\n    {\\n      type: 'assistant',\\n      text: messages.requestSourceCode,\\n      functionCalls: [getSourceCodeRequest, ...(codegenPrompt.options.historyEnabled ? [{ name: 'readHistory' }] : [])],\\n    },\\n  ];\\n\\n  const getSourceCodeResponse: PromptItem = {\\n    type: 'user',\\n    functionResponses: [\\n      { name: 'getSourceCode', content: messages.sourceCode },\\n      ...(codegenPrompt.options.historyEnabled ? [{ name: 'readHistory', content: getCurrentHistory() }] : []),\\n    ],\\n    cache: true,\\n  };\\n  prompt.push(getSourceCodeResponse);\\n\\n  if (codegenPrompt.options.vision) {\\n    prompt.slice(-1)[0].text = messages.suggestImageAssets;\\n    prompt.push(\\n      { type: 'assistant', text: messages.requestImageAssets, functionCalls: [{ name: 'getImageAssets' }] },\\n      { type: 'user', functionResponses: [{ name: 'getImageAssets', content: messages.imageAssets }] },\\n    );\\n  }\\n\\n  prompt.slice(-1)[0].text = messages.prompt;\\n\\n  // Add uploaded images to the prompt if available\\n  if (codegenPrompt.options.images && codegenPrompt.options.images.length > 0 && codegenPrompt.options.vision) {\\n    prompt.slice(-1)[0].images = codegenPrompt.options.images.map((img) => ({\\n      base64url: img.base64url,\\n      mediaType: img.mediaType,\\n    }));\\n  }\\n\\n  // Initial summary based on first user input\\n  await executeStepGenerateSummary(generateContentFn, prompt, codegenPrompt.options);\\n\\n  // Execute the context optimization step\\n  if (!codegenPrompt.options.disableContextOptimization) {\\n    const optimizationResult = await executeStepContextOptimization(generateContentFn, prompt, codegenPrompt.options);\\n\\n    if (optimizationResult === StepResult.BREAK) {\\n      return { result: [], prompt };\\n    }\\n  }\\n\\n  // Execute the ask question step\\n  if (codegenPrompt.options.askQuestion !== false && (codegenPrompt.options.interactive || codegenPrompt.options.ui)) {\\n    const askQuestionResult = await executeStepAskQuestion(\\n      generateContentFn,\\n      generateImageFn,\\n      prompt,\\n      getFunctionDefs(),\\n      codegenPrompt.options.temperature ?? 0.7,\\n      messages,\\n      codegenPrompt.options,\\n    );\\n\\n    // Summary based on the ask-question conversation history (may be different from the initial summary)\\n    await executeStepGenerateSummary(generateContentFn, prompt, codegenPrompt.options);\\n\\n    if (askQuestionResult === StepResult.BREAK) {\\n      return { result: [], prompt };\\n    }\\n  } else if (codegenPrompt.options.askQuestion === false) {\\n    console.log('Ask question is not enabled.');\\n    // Also there is no need to generate conversation summary\\n  }\\n\\n  const baseRequest: [PromptItem[], FunctionDef[], string, number, boolean, CodegenOptions] = [\\n    prompt,\\n    getFunctionDefs(),\\n    'codegenSummary',\\n    codegenPrompt.options.temperature ?? 0.7,\\n    codegenPrompt.options.cheap ?? false,\\n    codegenPrompt.options,\\n  ];\\n  let baseResult = await generateContentFn(...baseRequest);\\n\\n  let codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary');\\n\\n  if (codegenSummaryRequest) {\\n    // Second stage: for each file request the actual code updates\\n    putSystemMessage('Received codegen summary, will collect partial updates', codegenSummaryRequest.args);\\n\\n    baseResult = await validateAndRecoverSingleResult(baseRequest, baseResult, generateContentFn);\\n    codegenSummaryRequest = baseResult.find((call) => call.name === 'codegenSummary');\\n\\n    // Sometimes the result happens to be a string\\n    assert(Array.isArray(codegenSummaryRequest?.args?.fileUpdates), 'fileUpdates is not an array');\\n    assert(Array.isArray(codegenSummaryRequest?.args.contextPaths), 'contextPaths is not an array');\\n\\n    if (!codegenPrompt.options.disableContextOptimization) {\\n      console.log('Optimize with context paths.');\\n      // Monkey patch the initial getSourceCode, do not send parts of source code that are consider irrelevant\\n      getSourceCodeRequest.args = {\\n        filePaths: [\\n          ...codegenSummaryRequest.args.fileUpdates.map((file: { filePath: string }) => file.filePath),\\n          ...codegenSummaryRequest.args.contextPaths,\\n          ...(importantContext.files ?? []),\\n        ],\\n      };\\n      getSourceCodeResponse.functionResponses!.find((item) => item.name === 'getSourceCode')!.content =\\n        messages.contextSourceCode(getSourceCodeRequest.args?.filePaths as string[]);\\n    }\\n\\n    // Store the first stage response entirely in conversation history\\n    prompt.push({ type: 'assistant', functionCalls: baseResult });\\n    prompt.push({\\n      type: 'user',\\n      functionResponses: baseResult.map((call) => ({ name: call.name, call_id: call.id })),\\n      cache: true,\\n    });\\n\\n    const result: FunctionCall[] = [];\\n\\n    for (const file of codegenSummaryRequest!.args.fileUpdates) {\\n      putSystemMessage('Collecting partial update for: ' + file.filePath + ' using tool: ' + file.updateToolName, file);\\n      console.log('- Prompt:', file.prompt);\\n      console.log('- Temperature', file.temperature);\\n      console.log('- Cheap', file.cheap);\\n      if (codegenPrompt.options.vision) {\\n        console.log('- Context image assets', file.contextImageAssets);\\n      }\\n\\n      // Check if execution is paused before proceeding\\n      await waitIfPaused();\\n\\n      // this is needed, otherwise we will get an error\\n      if (prompt.slice(-1)[0].type === 'user') {\\n        prompt.slice(-1)[0].text = file.prompt ?? messages.partialPromptTemplate(file.filePath);\\n      } else {\\n        prompt.push({ type: 'user', text: file.prompt ?? messages.partialPromptTemplate(file.filePath) });\\n      }\\n\\n      if (codegenPrompt.options.vision && file.contextImageAssets) {\\n        prompt.slice(-1)[0].images = file.contextImageAssets.map((path: string) => ({\\n          path,\\n          base64url: fs.readFileSync(path, 'base64'),\\n          mediaType: mime.lookup(path) || '',\\n        }));\\n      }\\n\\n      const partialRequest: [PromptItem[], FunctionDef[], string, number, boolean, CodegenOptions] = [\\n        prompt,\\n        getFunctionDefs(),\\n        file.updateToolName,\\n        file.temperature ?? codegenPrompt.options.temperature,\\n        file.cheap === true,\\n        codegenPrompt.options,\\n      ];\\n      let partialResult = await generateContentFn(...partialRequest);\\n\\n      putSystemMessage('Received partial update', partialResult);\\n\\n      // Validate if function call is compliant with the schema\\n      partialResult = await validateAndRecoverSingleResult(partialRequest, partialResult, generateContentFn);\\n\\n      // Handle image generation requests\\n      const generateImageCall = partialResult.find((call) => call.name === 'generateImage');\\n      if (generateImageCall) {\\n        partialResult.push(await executeStepGenerateImage(generateImageFn, generateImageCall));\\n      }\\n\\n      // Verify if patchFile is one of the functions called, and test if patch is valid and can be applied successfully\\n      const patchFileCall = partialResult.find((call) => call.name === 'patchFile');\\n      if (patchFileCall) {\\n        partialResult = await executeStepVerifyPatch(\\n          patchFileCall.args as { filePath: string; patch: string },\\n          generateContentFn,\\n          prompt,\\n          getFunctionDefs(),\\n          file.temperature ?? codegenPrompt.options.temperature,\\n          file.cheap === true,\\n          codegenPrompt.options,\\n        );\\n      }\\n\\n      // add the code gen result to the context, as the subsequent code gen may depend on the result\\n      prompt.push(\\n        { type: 'assistant', functionCalls: partialResult },\\n        {\\n          type: 'user',\\n          text: 'Update applied.',\\n          functionResponses: partialResult.map((call) => ({ name: call.name, call_id: call.id })),\\n        },\\n      );\\n\\n      result.push(...partialResult);\\n    }\\n\\n    return { result, prompt };\\n  } else {\\n    // This is unexpected, if happens probably means no code updates.\\n    putSystemMessage('Did not receive codegen summary, returning result.');\\n    return { result: baseResult, prompt };\\n  }\\n}\\n\\n/**\\n * Function to prepare messages for AI services\\n */\\nfunction prepareMessages(codegen: CodegenPrompt) {\\n  return {\\n    suggestSourceCode: 'I should provide you with application source code.',\\n    requestSourceCode: 'Please provide application source code.',\\n    suggestImageAssets: 'I should also provide you with a summary of application image assets',\\n    requestImageAssets: 'Please provide summary of application image assets.',\\n    prompt:\\n      codegen.prompt +\\n      '\\\\n Start from generating codegen summary, this summary will be used as a context to generate updates, so make sure that it contains useful information.',\\n    sourceCode: JSON.stringify(\\n      getSourceCodeTree(getSourceCode({ taskFile: codegen.options.taskFile }, codegen.options)),\\n    ),\\n    contextSourceCode: (paths: string[], pathsOnly: boolean = false) =>\\n      JSON.stringify(\\n        getSourceCodeTree(\\n          Object.fromEntries(\\n            Object.entries(\\n              getSourceCode(\\n                { filterPaths: paths, taskFile: codegen.options.taskFile, forceAll: true },\\n                codegen.options,\\n              ),\\n            ).filter(([path]) => !pathsOnly || paths.includes(path)),\\n          ),\\n        ),\\n      ),\\n    imageAssets: JSON.stringify(getImageAssets()),\\n    partialPromptTemplate(path: string) {\\n      return `Thank you for providing the summary, now suggest changes for the \\\\`${path}\\\\` file using appropriate tools.`;\\n    },\\n  };\\n}\\n\"},\"/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question/handlers/confirm-code-generation.ts\":{\"content\":\"import { putSystemMessage } from '../../../../main/common/content-bus.js';\\nimport { askUserForConfirmationWithAnswer } from '../../../../main/common/user-actions.js';\\nimport { StepResult } from '../../steps-types.js';\\nimport { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';\\n\\nexport async function handleConfirmCodeGeneration({\\n  askQuestionCall,\\n  options,\\n}: ActionHandlerProps): Promise<ActionResult> {\\n  const userConfirmation = await askUserForConfirmationWithAnswer(\\n    'The assistant is ready to start code generation. Do you want to proceed?',\\n    'Start code generation',\\n    'Continue conversation',\\n    true,\\n  );\\n  if (userConfirmation.options?.aiService) {\\n    options.aiService = userConfirmation.options.aiService;\\n  }\\n  if (userConfirmation.confirmed) {\\n    putSystemMessage('Proceeding with code generation.');\\n    return {\\n      breakLoop: true,\\n      stepResult: StepResult.CONTINUE,\\n      items: [\\n        {\\n          assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [] },\\n          user: { type: 'user', text: userConfirmation.answer || 'Confirmed. Proceed with code generation.' },\\n        },\\n      ],\\n    };\\n  } else {\\n    putSystemMessage('Declined. Continuing the conversation.');\\n    return {\\n      breakLoop: false,\\n      stepResult: StepResult.CONTINUE,\\n      items: [\\n        {\\n          assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },\\n          user: {\\n            type: 'user',\\n            text: userConfirmation.answer || 'Declined. Please continue the conversation.',\\n            functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id, content: undefined }],\\n          },\\n        },\\n      ],\\n    };\\n  }\\n}\\n\"},\"/Users/gtanczyk/src/codegen/src/prompt/steps/step-ask-question/handlers/handle-request-answer.ts\":{\"content\":\"import { askUserForInput } from '../../../../main/common/user-actions.js';\\nimport { StepResult } from '../../steps-types.js';\\nimport { ActionHandlerProps, ActionResult } from '../step-ask-question-types.js';\\n\\nexport async function handleRequestAnswer({ askQuestionCall, options }: ActionHandlerProps): Promise<ActionResult> {\\n  const response = await askUserForInput('Your answer', askQuestionCall.args?.content ?? '');\\n  if (response.options?.aiService) {\\n    options.aiService = response.options.aiService;\\n  }\\n  return {\\n    breakLoop: false,\\n    stepResult: StepResult.CONTINUE,\\n    items: [\\n      {\\n        assistant: { type: 'assistant', text: askQuestionCall.args?.content ?? '', functionCalls: [askQuestionCall] },\\n        user: {\\n          type: 'user',\\n          text: response.answer,\\n          functionResponses: [{ name: 'askQuestion', call_id: askQuestionCall.id, content: undefined }],\\n        },\\n      },\\n    ],\\n  };\\n}\\n\"}}",
      },
    ],
    cache: true,
  },
];

export const DEBUG_PROMPT_8 = [
  ...DEBUG_PROMPT_7,
  {
    type: 'assistant',
    text: "Based on the analysis of the existing implementation, the AI service selector currently has a dropdown to select the AI service, but it does not have a checkbox for cheap/non-cheap mode. To implement the desired behavior, I will need to:\n\n1. Add a checkbox to the AI service selector component to control the cheap/non-cheap mode.\n2. Update the state management to keep track of the cheap setting, similar to how the AI service is managed.\n3. Ensure that the cheap setting is propagated to the `codegenSummary` function call, so that the code generation process can use the correct setting.\n4. Update the `handleQuestionSubmit` function in the `AppHandlers` component to allow the user to select the cheap/non-cheap mode when answering a question.\n\nPlease confirm if this is the correct approach to implement the desired functionality. I'm ready to proceed with the code changes once you confirm the plan.",
    functionCalls: [
      {
        id: 'toolu_01Ac9uMwnkZvkfaC5BPkEnqv',
        name: 'askQuestion',
        args: {
          actionType: 'requestAnswer',
          content:
            "Based on the analysis of the existing implementation, the AI service selector currently has a dropdown to select the AI service, but it does not have a checkbox for cheap/non-cheap mode. To implement the desired behavior, I will need to:\n\n1. Add a checkbox to the AI service selector component to control the cheap/non-cheap mode.\n2. Update the state management to keep track of the cheap setting, similar to how the AI service is managed.\n3. Ensure that the cheap setting is propagated to the `codegenSummary` function call, so that the code generation process can use the correct setting.\n4. Update the `handleQuestionSubmit` function in the `AppHandlers` component to allow the user to select the cheap/non-cheap mode when answering a question.\n\nPlease confirm if this is the correct approach to implement the desired functionality. I'm ready to proceed with the code changes once you confirm the plan.",
        },
      },
    ],
  },
  {
    type: 'user',
    text: "I'm not sure,\n\nstart of the journey is in the ui: service selector componet\nend of the journey is in ask question step action handlers",
    functionResponses: [
      {
        name: 'askQuestion',
        call_id: 'toolu_01Ac9uMwnkZvkfaC5BPkEnqv',
        content: undefined,
      },
    ],
  },
];

import { ModelSpecificSettings } from '../ai-service/service-configurations-types.js';
import { Plugin } from './codegen-types.js';

export interface ImportantContext {
  systemPrompt?: string[];
  files?: string[];
}

/**
 * Model configuration for each supported AI service
 * Each service can have different model types:
 * - default: Standard model, typically most capable but expensive
 * - cheap: Cost-effective model with potentially lower quality
 * Specific settings like system instructions or token limits can be defined per model.
 */
export interface ServiceModelConfig {
  /** Model ID for cost-effective operations */
  cheap?: string;
  /** Model ID for lite operations */
  lite?: string;
  /** Model ID for standard operations (default model) */
  default?: string;
  /** Specific settings for individual models within this service */
  modelSpecificSettings?: {
    [modelName: string]: ModelSpecificSettings;
  };
}

export interface ModelOverrides {
  openai?: ServiceModelConfig;
  anthropic?: ServiceModelConfig;
  vertexAi?: ServiceModelConfig;
  aiStudio?: ServiceModelConfig;
  localLlm?: ServiceModelConfig;
  githubModels?: ServiceModelConfig;
}

/**
 * Defines a project-specific command that can be executed by the AI.
 */
export interface ProjectCommand {
  /** The command string to execute. Can include shell operators. */
  command: string;
  /** A brief description of what the command does. */
  description?: string;
  /** Default arguments to pass to the command. */
  defaultArgs?: string[];
  /** Environment variables to set for the command execution. */
  env?: Record<string, string>;
  /** The working directory to run the command in. Defaults to rootDir. */
  workingDir?: string;
  /** Optional aliases for the command name. */
  aliases?: string[];
  /**
   * Determines if the command should be executed without user confirmation.
   * - If `true`, the command is always executed.
   * - If a `string`, it's a natural language condition evaluated by the AI.
   *   If the condition is met, the command is executed without a prompt.
   */
  autoApprove?: boolean | string;
}

/**
 * Configuration for the project codegen
 *
 * IMPORTANT: Keep this interface in sync with the JSON schema in config-schema.ts
 */
export interface RcConfig {
  rootDir: string;
  lintCommand?: string;
  extensions?: string[];
  ignorePaths?: string[];
  popularDependencies?: {
    enabled?: boolean;
    threshold?: number;
  };
  importantContext?: ImportantContext;
  modelOverrides?: ModelOverrides;
  /**
   * An array of plugins to load. Each item can be:
   * - A `string` representing a file path to a plugin.
   * - A `PluginSpec` object for importing a plugin from a module.
   * - An inline `Plugin` object (only in JS/TS config files).
   */
  plugins?: (string | Plugin)[];
  /**
   * A map of named project-specific commands that can be executed.
   * @example
   * "projectCommands": {
   *   "test": { "command": "npm run test", "description": "Run unit tests" },
   *   "lint:fix": { "command": "npm run lint -- --fix" }
   * }
   */
  projectCommands?: Record<string, ProjectCommand>;
  featuresEnabled?: {
    appContext?: boolean;
    gitContext?: boolean;
    containerTask?: boolean;
  };
}

export function defineConfig(config: RcConfig): RcConfig {
  return config;
}

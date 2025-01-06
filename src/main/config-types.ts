export interface ImportantContext {
  systemPrompt?: string[];
  files?: string[];
}

export interface ModelOverrides {
  openai?: {
    cheap?: string;
    default?: string;
  };
  anthropic?: {
    cheap?: string;
    default?: string;
  };
  vertexAi?: {
    cheap?: string;
    default?: string;
  };
  aiStudio?: {
    cheap?: string;
    default?: string;
  };
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
  importantContext?: ImportantContext;
  modelOverrides?: ModelOverrides;
  plugins?: string[];
}

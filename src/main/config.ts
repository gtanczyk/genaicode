import { RcConfig, ImportantContext, ModelOverrides } from './config-types.js';
import { findRcFile, parseRcFile, CODEGENRC_FILENAME } from './config-lib.js';
import { loadPlugins } from './plugin-loader.js';
import path from 'path';
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_PATHS } from '../project-profiles/index.js';
import { SCHEMA_VIRTUAL_FILE_NAME } from './config-schema.js';

// Read and parse the configuration
const rcFilePath: string = await findRcFile();
export const rcConfig: RcConfig = parseRcFile(rcFilePath);

export const rcConfigSchemaFilePath = path.join(rcConfig.rootDir, SCHEMA_VIRTUAL_FILE_NAME);

await loadPlugins(rcConfig);

export const sourceExtensions: string[] = rcConfig.extensions ?? [...DEFAULT_EXTENSIONS.JS];

// Image extensions (driven by ai service limitations, so not configurable)
export const IMAGE_ASSET_EXTENSIONS: string[] = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

export const ignorePaths: string[] = rcConfig.ignorePaths ?? [...DEFAULT_IGNORE_PATHS.JS];

export const importantContext: ImportantContext = processImportantContext(rcConfig.importantContext);

// modelOverrides is directly assigned. Downstream code in service-configurations.ts handles the structure.
export const modelOverrides: ModelOverrides = rcConfig.modelOverrides ?? {};

function processImportantContext(context: ImportantContext | undefined): ImportantContext {
  if (!context) {
    return { systemPrompt: [], files: [] };
  }

  // Always include .genaicoderc in important files
  const files = context.files || [];
  if (!files.includes(CODEGENRC_FILENAME)) {
    files.push(CODEGENRC_FILENAME);
  }

  return {
    systemPrompt: context.systemPrompt || [],
    files: files.map((file) => path.resolve(rcConfig.rootDir, file)),
  };
}

console.log('Detected codegen configuration', rcConfig);
console.log('Root dir:', rcConfig.rootDir);
console.log('Important context:', importantContext);
console.log('Model overrides:', modelOverrides);

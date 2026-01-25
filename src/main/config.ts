import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { ImportantContext, ModelOverrides, ProjectCommand } from './config-types.js';
import { loadConfiguration } from './config-lib.js';
import { loadPlugins } from './plugin-loader.js';
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_PATHS } from '../project-profiles/index.js';
import { SCHEMA_VIRTUAL_FILE_NAME } from './config-schema.js';
import { checkDockerAvailability } from '../prompt/steps/step-iterate/handlers/container-task/utils/docker-check.js';

// Read and parse the configuration
const { rcConfig, configFilePath } = await loadConfiguration();

// Initialize popularDependencies with defaults if not present
if (rcConfig.popularDependencies === undefined) {
  rcConfig.popularDependencies = { enabled: true, threshold: 20 };
} else {
  if (rcConfig.popularDependencies.enabled === undefined) {
    rcConfig.popularDependencies.enabled = true;
  }
  if (rcConfig.popularDependencies.threshold === undefined) {
    rcConfig.popularDependencies.threshold = 20;
  } else if (rcConfig.popularDependencies.threshold < 0) {
    rcConfig.popularDependencies.threshold = 0;
  }
}

if (typeof rcConfig.featuresEnabled === 'undefined') {
  rcConfig.featuresEnabled = {};
}

if (typeof rcConfig.featuresEnabled?.gitContext === 'undefined') {
  rcConfig.featuresEnabled.gitContext = await simpleGit(rcConfig.rootDir).checkIsRepo();
}

if (typeof rcConfig.featuresEnabled?.containerTask === 'undefined') {
  rcConfig.featuresEnabled.containerTask = await checkDockerAvailability();
}

export const rcConfigSchemaFilePath = path.join(rcConfig.rootDir, SCHEMA_VIRTUAL_FILE_NAME);

await loadPlugins(rcConfig);

export const sourceExtensions: string[] = rcConfig.extensions ?? [...DEFAULT_EXTENSIONS.JS];

// Image extensions (driven by ai service limitations, so not configurable)
export const IMAGE_ASSET_EXTENSIONS: string[] = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

export const ignorePaths: string[] = rcConfig.ignorePaths ?? [...DEFAULT_IGNORE_PATHS.JS];

export const importantContext: ImportantContext = processImportantContext(rcConfig.importantContext, configFilePath);

// modelOverrides is directly assigned. Downstream code in service-configurations.ts handles the structure.
export const modelOverrides: ModelOverrides = rcConfig.modelOverrides ?? {};

type ResolvedProjectCommand = ProjectCommand & { name: string };
const projectCommandsMap = new Map<string, ResolvedProjectCommand>();

// 1. Populate from rcConfig.projectCommands
if (rcConfig.projectCommands) {
  for (const [name, command] of Object.entries(rcConfig.projectCommands)) {
    const resolvedCommand = { ...command, name };
    projectCommandsMap.set(name, resolvedCommand);
    // Add aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        projectCommandsMap.set(alias, resolvedCommand);
      }
    }
  }
}

// 2. Synthesize from legacy lintCommand for backward compatibility
if (rcConfig.lintCommand && !projectCommandsMap.has('lint')) {
  projectCommandsMap.set('lint', {
    name: 'lint',
    command: rcConfig.lintCommand,
    description: 'Legacy lint command (from lintCommand)',
  });
}

// 3. Auto-discover from package.json scripts
try {
  const packageJsonPath = path.join(rcConfig.rootDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    if (packageJson.scripts) {
      for (const scriptName in packageJson.scripts) {
        if (!projectCommandsMap.has(scriptName)) {
          projectCommandsMap.set(scriptName, {
            name: scriptName,
            command: `npm run ${scriptName}`,
            description: `package.json script: ${scriptName}`,
          });
        }
      }
    }
  }
} catch (error) {
  console.warn('Could not read or parse package.json for script discovery:', error);
}

export const getProjectCommands = (): Map<string, ResolvedProjectCommand> => projectCommandsMap;
export const getProjectCommand = (name: string): ResolvedProjectCommand | undefined => projectCommandsMap.get(name);

function processImportantContext(context: ImportantContext | undefined, configFilePath: string): ImportantContext {
  if (!context) {
    return { systemPrompt: [], files: [configFilePath] };
  }

  // Resolve user-defined important files relative to the rootDir
  const resolvedUserFiles = (context.files || []).map((file) => path.resolve(rcConfig.rootDir, file));

  // Ensure the absolute path to the config file is included
  if (!resolvedUserFiles.includes(configFilePath)) {
    resolvedUserFiles.push(configFilePath);
  }

  return {
    systemPrompt: context.systemPrompt || [],
    files: resolvedUserFiles,
  };
}

console.log('Detected codegen configuration', rcConfig);
console.log('Root dir:', rcConfig.rootDir);
console.log('Important context:', importantContext);
console.log('Model overrides:', modelOverrides);
console.log('Project commands:', projectCommandsMap);

export { rcConfig, configFilePath };

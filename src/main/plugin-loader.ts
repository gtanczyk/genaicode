import path from 'path';
import { Operation, Plugin, PluginActionType, PluginAiServiceType, GenerateContentHook } from './codegen-types.js';
import { GenerateContentFunction } from '../ai-service/common.js';
import { ActionHandler } from '../prompt/steps/step-ask-question/step-ask-question-types.js';
import { RcConfig } from './config-lib.js';
import { ProjectProfile, ProjectProfilePlugin } from '../project-profiles/types.js';
import { registerProfile } from '../project-profiles/index.js';

// Global storage for registered AI services and operations
const registeredAiServices: Map<PluginAiServiceType, GenerateContentFunction> = new Map();
const registeredOperations: Record<string, Operation> = {};
const registeredActionHandlerDescriptions: Map<PluginActionType, string> = new Map();
const registeredActionHandlers: Map<PluginActionType, ActionHandler> = new Map();
const registeredGenerateContentHooks: GenerateContentHook[] = [];

// Project profile plugin storage
const registeredProfilePlugins: ProjectProfilePlugin[] = [];

export async function loadPlugins(rcConfig: RcConfig): Promise<void> {
  if (!rcConfig.plugins || rcConfig.plugins.length === 0) {
    console.log('No plugins specified in the configuration.');
    return;
  }

  for (let pluginPath of rcConfig.plugins) {
    try {
      pluginPath = path.isAbsolute(pluginPath) ? pluginPath : path.join(rcConfig.rootDir, pluginPath);
      console.log('Loading plugin:', pluginPath);
      const plugin = (await import(pluginPath)).default as Plugin;

      // Handle AI services
      if (plugin.aiServices) {
        Object.entries(plugin.aiServices).forEach(([name, service]) => {
          registeredAiServices.set(`plugin:${name}`, service);
          console.log(`Registered AI service: ${name}`);
        });
      }

      // Handle operations
      if (plugin.operations) {
        Object.entries(plugin.operations).forEach(([name, operation]) => {
          registeredOperations[name] = operation;
          console.log(`Registered operation: ${name}`);
        });
      }

      // Handle action handlers
      if (plugin.actionHandlers) {
        Object.entries(plugin.actionHandlers).forEach(([name, { handler, description }]) => {
          registeredActionHandlers.set(`plugin:${name}`, handler);
          registeredActionHandlerDescriptions.set(`plugin:${name}`, description);
          console.log(`Registered action handler: ${name}`);
        });
      }

      // Handle generateContent hooks
      if (plugin.generateContentHook) {
        registeredGenerateContentHooks.push(plugin.generateContentHook);
        console.log('Registered generateContent hook');
      }

      // Handle project profile plugins
      if ('profiles' in plugin) {
        const profilePlugin = plugin as Plugin & ProjectProfilePlugin;

        // Register project profiles
        if (profilePlugin.profiles) {
          profilePlugin.profiles.forEach((profile: ProjectProfile) => {
            // Validate profile
            validateProfile(profile);
            // Register profile
            registerProfile(profile);
            console.log(`Registered project profile: ${profile.name} (${profile.id})`);
          });
        }
      }

      console.log(`Successfully loaded plugin: ${pluginPath}`);
    } catch (error) {
      console.error(`Failed to load plugin: ${pluginPath}`, error);
    }
  }
}

/**
 * Validate project profile structure
 */
function validateProfile(profile: ProjectProfile): void {
  if (!profile.id || typeof profile.id !== 'string') {
    throw new Error('Profile must have a string id');
  }
  if (!profile.name || typeof profile.name !== 'string') {
    throw new Error('Profile must have a string name');
  }
  if (!Array.isArray(profile.extensions)) {
    throw new Error('Profile must have an array of extensions');
  }
  if (!Array.isArray(profile.ignorePaths)) {
    throw new Error('Profile must have an array of ignore paths');
  }
  if (!profile.detect || typeof profile.detect !== 'function') {
    throw new Error('Profile must have a detect function');
  }
  if (typeof profile.detectionWeight !== 'number') {
    throw new Error('Profile must have a numeric detectionWeight');
  }
  if (profile.initialize && typeof profile.initialize !== 'function') {
    throw new Error('Profile initialize must be a function if provided');
  }
}

export function getRegisteredAiServices(): Map<PluginAiServiceType, GenerateContentFunction> {
  return registeredAiServices;
}

export function getRegisteredOperations(): Operation[] {
  return Object.values(registeredOperations);
}

export function getRegisteredActionHandlers(): Map<PluginActionType, ActionHandler> {
  return registeredActionHandlers;
}

export function getRegisteredActionHandlerDescriptions(): Map<PluginActionType, string> {
  return registeredActionHandlerDescriptions;
}

export function getRegisteredGenerateContentHooks(): GenerateContentHook[] {
  return registeredGenerateContentHooks;
}

/**
 * Get all registered project profile plugins
 */
export function getRegisteredProfilePlugins(): ProjectProfilePlugin[] {
  return registeredProfilePlugins;
}

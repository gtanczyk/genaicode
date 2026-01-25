import path from 'path';
import { Operation, Plugin, PlanningPreHook, PlanningPostHook } from './codegen-types.js';
import { PluginActionType, PluginAiServiceType } from '../ai-service/service-configurations-types.js';
import { GenerateContentFunction, GenerateContentHook } from '../ai-service/common-types.js';
import { ActionHandler } from '../prompt/steps/step-iterate/step-iterate-types.js';
import { RcConfig } from './config-types.js';
import { ProjectProfile, ProjectProfilePlugin } from '../project-profiles/types.js';
import { registerProfile } from '../project-profiles/index.js';
import { ServiceConfig } from '../ai-service/service-configurations-types.js';

// Global storage for registered plugins and their components
const loadedPlugins: Map<string, Plugin> = new Map();
const registeredAiServices: Map<
  PluginAiServiceType,
  { generateContent: GenerateContentFunction; serviceConfig: ServiceConfig }
> = new Map();
const registeredOperations: Record<string, Operation> = {};
const registeredActionHandlerDescriptions: Map<PluginActionType, string> = new Map();
const registeredActionHandlers: Map<PluginActionType, ActionHandler> = new Map();
const registeredGenerateContentHooks: GenerateContentHook[] = [];
const registeredPlanningPreHooks: PlanningPreHook[] = [];
const registeredPlanningPostHooks: PlanningPostHook[] = [];
const registeredProfilePlugins: ProjectProfilePlugin[] = [];

/**
 * Validates a plugin's structure and required fields
 * @throws {Error} If plugin validation fails
 */
function validatePlugin(plugin: Plugin): void {
  if (!plugin.name) {
    throw new Error('Plugin must have a name');
  }

  // Validate AI services if present
  if (plugin.aiServices) {
    Object.entries(plugin.aiServices).forEach(([name, service]) => {
      if (!service.generateContent || typeof service.generateContent !== 'function') {
        throw new Error(`AI service ${name} must have a generateContent function`);
      }
      if (!service.serviceConfig) {
        throw new Error(`AI service ${name} must have a serviceConfig`);
      }
    });
  }

  // Validate operations if present
  if (plugin.operations) {
    Object.entries(plugin.operations).forEach(([name, operation]) => {
      if (!operation.executor || typeof operation.executor !== 'function') {
        throw new Error(`Operation ${name} must have an executor function`);
      }
      if (!operation.def) {
        throw new Error(`Operation ${name} must have a definition`);
      }
    });
  }

  // Validate action handlers if present
  if (plugin.actionHandlers) {
    Object.entries(plugin.actionHandlers).forEach(([name, { handler, description }]) => {
      if (!handler || typeof handler !== 'function') {
        throw new Error(`Action handler ${name} must have a handler function`);
      }
      if (!description) {
        throw new Error(`Action handler ${name} must have a description`);
      }
    });
  }

  // Validate hooks if present
  if (plugin.generateContentHook && typeof plugin.generateContentHook !== 'function') {
    throw new Error('generateContentHook must be a function');
  }
  if (plugin.planningPreHook && typeof plugin.planningPreHook !== 'function') {
    throw new Error('planningPreHook must be a function');
  }
  if (plugin.planningPostHook && typeof plugin.planningPostHook !== 'function') {
    throw new Error('planningPostHook must be a function');
  }

  // Validate project profiles if present
  if ('profiles' in plugin) {
    const profilePlugin = plugin as Plugin & ProjectProfilePlugin;
    if (!Array.isArray(profilePlugin.profiles)) {
      throw new Error('Plugin profiles must be an array');
    }
    profilePlugin.profiles.forEach(validateProfile);
  }
}

/**
 * Registers a single plugin with validation and idempotency checks
 * @throws {Error} If plugin registration fails
 */
export async function registerPlugin(plugin: Plugin, pluginPath?: string): Promise<void> {
  try {
    // Validate plugin structure
    validatePlugin(plugin);

    // Check if plugin is already loaded
    if (loadedPlugins.has(plugin.name)) {
      console.log(`Plugin ${plugin.name} is already loaded, overwriting registration`);
    }

    // Register AI services
    if (plugin.aiServices) {
      Object.entries(plugin.aiServices).forEach(([name, service]) => {
        registeredAiServices.set(`plugin:${name}`, service);
        console.log(`Registered AI service: ${name}`);
      });
    }

    // Register operations
    if (plugin.operations) {
      Object.entries(plugin.operations).forEach(([name, operation]) => {
        registeredOperations[name] = operation;
        console.log(`Registered operation: ${name}`);
      });
    }

    // Register action handlers
    if (plugin.actionHandlers) {
      Object.entries(plugin.actionHandlers).forEach(([name, { handler, description }]) => {
        registeredActionHandlers.set(`plugin:${name}`, handler);
        registeredActionHandlerDescriptions.set(`plugin:${name}`, description);
        console.log(`Registered action handler: ${name}`);
      });
    }

    // Register hooks
    if (plugin.generateContentHook) {
      registeredGenerateContentHooks.push(plugin.generateContentHook);
      console.log('Registered generateContent hook');
    }
    if (plugin.planningPreHook) {
      registeredPlanningPreHooks.push(plugin.planningPreHook);
      console.log('Registered planning pre-hook');
    }
    if (plugin.planningPostHook) {
      registeredPlanningPostHooks.push(plugin.planningPostHook);
      console.log('Registered planning post-hook');
    }

    // Register project profiles
    if ('profiles' in plugin) {
      const profilePlugin = plugin as Plugin & ProjectProfilePlugin;
      if (profilePlugin.profiles) {
        profilePlugin.profiles.forEach((profile: ProjectProfile) => {
          registerProfile(profile);
          console.log(`Registered project profile: ${profile.name} (${profile.id})`);
        });
      }
    }

    // Add plugin to loaded plugins registry
    loadedPlugins.set(plugin.name, plugin);
    console.log(`Successfully loaded plugin${pluginPath ? `: ${pluginPath}` : ': ' + plugin.name}`);
  } catch (error) {
    const errorMessage = `Failed to register plugin${pluginPath ? `: ${pluginPath}` : ': ' + plugin.name}`;
    console.error(errorMessage, error);
    throw new Error(`${errorMessage}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function isPluginObject(entry: unknown): entry is Plugin {
  return !!entry && typeof entry === 'object' && 'name' in (entry as Record<string, unknown>);
}

/**
 * Loads plugins from configuration with idempotency checks
 */
export async function loadPlugins(rcConfig: RcConfig): Promise<void> {
  if (!rcConfig.plugins || rcConfig.plugins.length === 0) {
    console.log('No plugins specified in the configuration.');
    return;
  }

  for (const item of rcConfig.plugins) {
    try {
      // Case 1: string path/module
      if (typeof item === 'string') {
        let pluginPath = item;
        // Resolve relative paths against project root
        if (!path.isAbsolute(pluginPath) && (pluginPath.startsWith('./') || pluginPath.startsWith('../'))) {
          pluginPath = path.join(rcConfig.rootDir, pluginPath);
        }
        console.log('Loading plugin:', pluginPath);
        const mod = await import(pluginPath);
        const plugin = (mod?.default ?? mod) as Plugin;
        await registerPlugin(plugin, pluginPath);
        continue;
      }

      // Case 2: direct inline plugin object
      if (isPluginObject(item)) {
        console.log('Registering inline plugin (direct object):', (item as Plugin).name ?? '<unnamed>');
        await registerPlugin(item as Plugin, '<inline-plugin>');
        continue;
      }

      // Unknown entry type
      console.error('Unsupported plugin entry format:', item);
      throw new Error('Unsupported plugin entry in configuration.');
    } catch (error) {
      console.error('Failed to load plugin entry:', item);
      console.error(error);
      throw error; // Re-throw to handle the error at a higher level
    }
  }
}

/**
 * Validates project profile structure
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

export function getRegisteredAiServices(): Map<
  PluginAiServiceType,
  { generateContent: GenerateContentFunction; serviceConfig: ServiceConfig }
> {
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

export function getRegisteredPlanningPreHooks(): PlanningPreHook[] {
  return registeredPlanningPreHooks;
}

export function getRegisteredPlanningPostHooks(): PlanningPostHook[] {
  return registeredPlanningPostHooks;
}

export function getRegisteredProfilePlugins(): ProjectProfilePlugin[] {
  return registeredProfilePlugins;
}

/**
 * Checks if a plugin is already loaded
 */
export function isPluginLoaded(pluginName: string): boolean {
  return loadedPlugins.has(pluginName);
}

/**
 * Gets a loaded plugin by name
 */
export function getLoadedPlugin(pluginName: string): Plugin | undefined {
  return loadedPlugins.get(pluginName);
}

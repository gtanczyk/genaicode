import path from 'path';
import { Operation, Plugin } from './codegen-types.js';
import { GenerateContentFunction } from '../ai-service/common.js';
import { RcConfig } from './config-lib.js';

// Global storage for registered AI services and operations
const registeredAiServices: Record<string, GenerateContentFunction> = {};
const registeredOperations: Record<string, Operation> = {};

export async function loadPlugins(rcConfig: RcConfig): Promise<void> {
  if (!rcConfig.plugins || rcConfig.plugins.length === 0) {
    console.log('No plugins specified in the configuration.');
    return;
  }

  for (let pluginPath of rcConfig.plugins) {
    try {
      pluginPath = path.isAbsolute(pluginPath) ? pluginPath : path.join(rcConfig.rootDir, pluginPath);
      const plugin = (await import(pluginPath)).default as Plugin;

      if (plugin.aiServices) {
        Object.entries(plugin.aiServices).forEach(([name, service]) => {
          registeredAiServices[name] = service;
          console.log(`Registered AI service: ${name}`);
        });
      }

      if (plugin.operations) {
        Object.entries(plugin.operations).forEach(([name, operation]) => {
          registeredOperations[name] = operation;
          console.log(`Registered operation: ${name}`);
        });
      }

      console.log(`Successfully loaded plugin: ${pluginPath}`);
    } catch (error) {
      console.error(`Failed to load plugin: ${pluginPath}`, error);
    }
  }
}

export function getRegisteredAiServices(): Record<string, GenerateContentFunction> {
  return registeredAiServices;
}

export function getRegisteredOperations(): Operation[] {
  return Object.values(registeredOperations);
}

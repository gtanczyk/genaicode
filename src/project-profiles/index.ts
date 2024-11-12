/**
 * Project Profiles System for GenAIcode
 *
 * This module provides project type detection and configuration management
 * for different types of projects. It includes default profiles for common
 * project types and supports custom profiles through plugins.
 */

import {
  ProjectProfile,
  ProfileDetectionResult,
  ProjectProfilePlugin,
  PROJECT_FILE_PATTERNS,
  DETECTION_WEIGHTS,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE_PATHS,
} from './types.js';

import { detectProjectProfile, initializeProfile, profileUtils } from './detection.js';

// Import default profiles
import { npmProfile } from './profiles/javascript-npm.js';
import { reactProfile } from './profiles/javascript-react.js';
import { mavenProfile } from './profiles/java-maven.js';
import { golangProfile } from './profiles/golang.js';
import { djangoProfile } from './profiles/python-django.js';

// Simple array to store all available profiles
const profiles: ProjectProfile[] = [];

/**
 * Register a project profile
 */
function registerProfile(profile: ProjectProfile): void {
  const existingIndex = profiles.findIndex((p) => p.id === profile.id);
  if (existingIndex !== -1) {
    console.warn(`Warning: Profile with ID "${profile.id}" is already registered. Overwriting...`);
    profiles[existingIndex] = profile;
  } else {
    profiles.push(profile);
  }
}

/**
 * Get a registered profile by ID
 */
function getProfile(id: string): ProjectProfile | undefined {
  return profiles.find((profile) => profile.id === id);
}

/**
 * Get all registered profiles
 */
function getAllProfiles(): ProjectProfile[] {
  return [...profiles];
}

/**
 * Register a project profile plugin
 */
function registerProfilePlugin(plugin: ProjectProfilePlugin): void {
  plugin.profiles.forEach(registerProfile);
}

// Register default profiles
[npmProfile, reactProfile, mavenProfile, golangProfile, djangoProfile].forEach(registerProfile);

/**
 * Main function to detect and configure project profile
 */
async function detectAndConfigureProfile(rootDir: string): Promise<ProfileDetectionResult> {
  const detectionResult = await detectProjectProfile(rootDir, getAllProfiles());

  if (detectionResult.profile) {
    // Initialize the profile
    await initializeProfile(rootDir, detectionResult);
  }

  return detectionResult;
}

// Export everything needed by other modules
export {
  // Types
  ProjectProfile,
  ProfileDetectionResult,
  ProjectProfilePlugin,

  // Constants
  PROJECT_FILE_PATTERNS,
  DETECTION_WEIGHTS,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE_PATHS,

  // Core functions
  detectAndConfigureProfile,
  registerProfile,
  registerProfilePlugin,
  getProfile,
  getAllProfiles,

  // Default profiles
  npmProfile,
  reactProfile,
  mavenProfile,
  golangProfile,
  djangoProfile,

  // Utilities
  profileUtils,
};

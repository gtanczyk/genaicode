import fs from 'fs';
import path from 'path';
import { ProjectProfile, ProfileDetectionResult } from './types.js';

/**
 * Check if a file exists in the given directory
 */
async function fileExists(rootDir: string, filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(rootDir, filePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if any of the files exist in the given directory
 */
async function anyFileExists(rootDir: string, filePaths: string[]): Promise<boolean> {
  const results = await Promise.all(filePaths.map((file) => fileExists(rootDir, file)));
  return results.some((exists) => exists);
}

/**
 * Detect the project profile with the highest weight
 */
export async function detectProjectProfile(
  rootDir: string,
  profiles: ProjectProfile[],
): Promise<ProfileDetectionResult> {
  // Run detection for all profiles
  const detectionResults = await Promise.all(
    profiles.map(async (profile) => {
      try {
        const matches = await profile.detect(rootDir);
        return {
          profile: matches ? profile : null,
          weight: matches ? profile.detectionWeight : 0,
        };
      } catch (error) {
        console.error(`Error detecting profile ${profile.id}:`, error);
        return {
          profile: null,
          weight: 0,
        };
      }
    }),
  );

  // Filter out non-matches and sort by weight (descending)
  const matches = detectionResults
    .filter((result): result is ProfileDetectionResult => result.profile !== null)
    .sort((a, b) => b.weight - a.weight);

  // If we have matches, return the highest weight match
  if (matches.length > 0) {
    const bestMatch = matches[0];
    if (matches.length > 1) {
      console.log(
        `Multiple matching profiles found. Selected "${bestMatch.profile?.name}" (weight: ${bestMatch.weight}) over:`,
        matches
          .slice(1)
          .map((match) => `"${match.profile?.name}" (weight: ${match.weight})`)
          .join(', '),
      );
    }
    return bestMatch;
  }

  // No matches found
  return {
    profile: null,
    weight: 0,
  };
}

/**
 * Initialize the selected profile
 */
export async function initializeProfile(
  rootDir: string,
  detectionResult: ProfileDetectionResult,
): Promise<ProfileDetectionResult> {
  if (detectionResult.profile?.initialize) {
    try {
      await detectionResult.profile.initialize(rootDir);
    } catch (error) {
      console.error(`Error initializing profile ${detectionResult.profile.id}:`, error);
    }
  }
  return detectionResult;
}

// Export utility functions for profile implementations
export const profileUtils = {
  fileExists,
  anyFileExists,
} as const;

import { FileId } from './source-code-types';

/**
 * Map to store file paths and their corresponding IDs
 */
const fileIdMap = new Map<string, FileId>();

/**
 * Counter for generating unique IDs
 */
let nextId = 1;

/**
 * Generates or retrieves a unique ID for a file path
 * @param filePath - The absolute path of the file
 * @returns A unique ID for the file path as a string
 */
export function generateFileId(filePath: string): FileId {
  // If the file path already has an ID, return it
  const existingId = fileIdMap.get(filePath);
  if (existingId) {
    return existingId;
  }

  // Generate a new ID, pad it with zeros for consistent length
  const newId = String(nextId++).padStart(6, '0') as FileId;
  fileIdMap.set(filePath, newId);
  return newId;
}

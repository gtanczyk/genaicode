import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { confirm } from '@inquirer/prompts';
import { ConfigLayer, loadConfig } from 'c12';
import { isAncestorDirectory } from '../files/file-utils.js';
import { loadConfiguration } from './config-lib.js';
import { detectAndConfigureProfile } from '../project-profiles/index.js';
import { RcConfig } from './config-types.js';

// Mock dependencies
vi.mock('fs');
vi.mock('path');
vi.mock('c12', () => ({
  loadConfig: vi.fn(),
}));
vi.mock('@inquirer/prompts');
vi.mock('../files/file-utils.js');
vi.mock('../project-profiles/index.js');

const mockCwd = '/project';
const mockRcFilePath = '/project/.genaicoderc';
const mockRcConfig: RcConfig = { rootDir: '.' };

describe('loadConfiguration', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);
    originalIsTTY = process.stdout.isTTY;
    process.argv = []; // Reset argv for each test
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
    });
  });

  const setIsTTY = (value: boolean) => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value,
      writable: true,
    });
  };

  it('should return config when found by c12', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: mockRcConfig,
      configFile: mockRcFilePath,
      layers: [{} as ConfigLayer],
    });
    vi.mocked(path.resolve).mockImplementation((...args) => args.join('/'));
    vi.mocked(path.dirname).mockReturnValue('/project');
    vi.mocked(isAncestorDirectory).mockReturnValue(true);

    const { rcConfig, configFilePath } = await loadConfiguration();

    expect(rcConfig).toEqual({ ...mockRcConfig, rootDir: '/project/.' });
    expect(configFilePath).toBe(mockRcFilePath);
    expect(isAncestorDirectory).toHaveBeenCalledWith('/project', '/project/.');
  });

  it('should throw an error if no config is found in a non-interactive session', async () => {
    vi.mocked(loadConfig).mockResolvedValue(null as never);
    setIsTTY(false);

    await expect(loadConfiguration()).rejects.toThrow('No GenAIcode config found in any parent directory.');
  });

  it('should prompt to create a config if none is found in an interactive session and user confirms', async () => {
    vi.mocked(loadConfig).mockResolvedValue(null as never);
    setIsTTY(true);
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(detectAndConfigureProfile).mockResolvedValue({
      profile: {
        id: 'test',
        name: 'Test',
        extensions: ['.js', '.ts'],
        ignorePaths: ['node_modules'],
        detectionWeight: 1,
        detect: vi.fn().mockResolvedValue(true),
      },
      weight: 1,
    });
    vi.mocked(path.join).mockReturnValue(`${mockCwd}/.genaicoderc`);
    vi.mocked(path.resolve).mockImplementation((...args) => args.join('/'));
    vi.mocked(path.dirname).mockReturnValue(mockCwd);

    const { configFilePath } = await loadConfiguration();

    expect(confirm).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(`${mockCwd}/.genaicoderc`, expect.any(String));
    expect(configFilePath).toBe(`${mockCwd}/.genaicoderc`);
  });

  it('should throw an error if user declines to create a config in an interactive session', async () => {
    vi.mocked(loadConfig).mockResolvedValue(null as never);
    setIsTTY(true);
    vi.mocked(confirm).mockResolvedValue(false);

    await expect(loadConfiguration()).rejects.toThrow('No GenAIcode config found in any parent directory.');
  });

  it('should throw an error for invalid config (missing rootDir)', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: {} as RcConfig, // Missing rootDir
      configFile: mockRcFilePath,
      layers: [{} as ConfigLayer],
    });

    await expect(loadConfiguration()).rejects.toThrow(/instance requires property "rootDir"/);
  });

  it('should throw an error if rootDir is outside the project directory', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: mockRcConfig,
      configFile: mockRcFilePath,
      layers: [{} as ConfigLayer],
    });
    vi.mocked(path.resolve).mockImplementation((...args) => args.join('/'));
    vi.mocked(path.dirname).mockReturnValue('/project');
    vi.mocked(isAncestorDirectory).mockReturnValue(false);

    await expect(loadConfiguration()).rejects.toThrow('Root dir is not located inside project directory');
  });
});

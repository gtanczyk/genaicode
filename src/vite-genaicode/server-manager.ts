import { Service } from '../main/ui/backend/service.js';
import { Server } from 'http';
import { CodegenOptions, Plugin } from '../main/codegen-types.js';
import { serviceAutoDetect } from '../cli/service-autodetect.js';
import { stringToAiServiceType } from '../main/codegen-utils.js';
import { registerPlugin } from '../main/plugin-loader.js';
import { GENAICODE_PORT } from './constants.js';

export class GenaicodeServerManager {
  private codegenService?: Service;
  private codegenServer?: Server;
  private appContextEnabled?: boolean;
  private initPromise: Promise<void> | null = null;
  private readonly genaicodePort: number;
  private _outDir?: string;

  constructor(
    private readonly options?: Partial<CodegenOptions>,
    private readonly config?: { plugins?: Plugin[]; genaicodePort?: number; logBufferMaxSize?: number },
    private readonly pluginFilename?: string,
  ) {
    this.genaicodePort = config?.genaicodePort ?? GENAICODE_PORT;
  }

  private async start(port?: number) {
    try {
      // Register inline plugins if provided
      for (const plugin of this.config?.plugins ?? []) {
        await registerPlugin(plugin, this.pluginFilename || '');
      }

      const { runCodegenUI } = await import('../main/ui/codegen-ui.js');

      console.log('Starting GenAIcode in UI mode...');

      const codegen = await runCodegenUI({
        ui: true,
        uiPort: this.genaicodePort,
        uiFrameAncestors: port ? ['http://localhost:' + port] : undefined,
        aiService: this.options?.aiService ?? stringToAiServiceType(serviceAutoDetect()),
        isDev: false,

        allowFileCreate: true,
        allowFileDelete: true,
        allowDirectoryCreate: true,
        allowFileMove: true,
        vision: true,

        temperature: 0.7,
        requireExplanations: true,
        askQuestion: true,
        historyEnabled: true,

        conversationSummaryEnabled: true,

        ...this.options,
      });

      this.codegenService = codegen.service;
      this.codegenServer = codegen.server;

      const genaicodeConfig = await this.codegenService.getRcConfig();

      if (typeof genaicodeConfig?.featuresEnabled?.appContext === 'undefined') {
        genaicodeConfig.featuresEnabled = {
          ...genaicodeConfig.featuresEnabled,
          appContext: true,
        };
      }

      this.appContextEnabled = genaicodeConfig.featuresEnabled?.appContext;
    } catch (error) {
      console.error('Failed to start GenAIcode UI:', error);
      throw error;
    }
  }

  public async ensureService(port?: number) {
    if (!this.initPromise) {
      this.initPromise = this.start(port);
    }
    await this.initPromise;
  }

  public close() {
    if (this.codegenServer) {
      console.log('Stopping GenAIcode...');
      this.codegenServer.close();
    }
  }

  public get service(): Service | undefined {
    return this.codegenService;
  }

  public get isAppContextEnabled(): boolean | undefined {
    return this.appContextEnabled;
  }

  public get port(): number {
    return this.genaicodePort;
  }

  public set outDir(dir: string) {
    this._outDir = dir;
  }

  public get outDir(): string | undefined {
    return this._outDir;
  }
}

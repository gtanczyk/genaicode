import { assistant, prompt, system, toPromptItems } from './prompt.js';
import { withPlugins, type GenAIPlugin } from './plugins.js';
import { parseJsonResult, resultText, resultToPromptItem, resultToolCalls } from './result.js';
import type {
  GenerationDefaults,
  GenerationRequest,
  GenerationResult,
  ModelProvider,
  PromptInput,
  PromptItem,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from './types.js';

export interface RequestBuilder {
  system(text: string): RequestBuilder;
  user(input: PromptInput): RequestBuilder;
  assistant(text: string, toolCalls?: ToolCall[]): RequestBuilder;
  model(model: string): RequestBuilder;
  temperature(temperature: number): RequestBuilder;
  maxOutputTokens(maxOutputTokens: number): RequestBuilder;
  tools(tools: ToolDefinition[], choice?: ToolChoice): RequestBuilder;
  signal(signal: AbortSignal): RequestBuilder;
  run(): Promise<GenerationResult>;
  text(): Promise<string>;
  json<T = unknown>(parse?: (value: unknown) => T): Promise<T>;
  toolCalls(): Promise<ToolCall[]>;
  inspect(): GenerationRequest;
}

export type ConfigureRequest = (request: RequestBuilder) => RequestBuilder;

export interface Conversation {
  ask(input: PromptInput, configure?: ConfigureRequest): Promise<GenerationResult>;
  text(input: PromptInput, configure?: ConfigureRequest): Promise<string>;
  json<T = unknown>(input: PromptInput, parse?: (value: unknown) => T, configure?: ConfigureRequest): Promise<T>;
  toolCalls(input: PromptInput, configure?: ConfigureRequest): Promise<ToolCall[]>;
  history(): PromptItem[];
  reset(...initial: PromptInput[]): void;
}

export interface GenAIClient {
  (input: PromptInput): RequestBuilder;
  prompt(...inputs: PromptInput[]): RequestBuilder;
  chain(...initial: PromptInput[]): Conversation;
  readonly provider: ModelProvider;
}

export interface GenAIClientOptions extends GenerationDefaults {
  plugins?: readonly GenAIPlugin[];
}

interface BuilderState extends GenerationDefaults {
  prompt: PromptItem[];
  signal?: AbortSignal;
}

class RequestBuilderImpl implements RequestBuilder {
  constructor(
    private readonly provider: ModelProvider,
    private readonly state: BuilderState,
  ) {}

  private copy(change: Partial<BuilderState>): RequestBuilder {
    return new RequestBuilderImpl(this.provider, {
      ...this.state,
      ...change,
      prompt: change.prompt ?? this.state.prompt,
    });
  }

  system(text: string): RequestBuilder {
    const nextPrompt = [...this.state.prompt];
    const firstNonSystem = nextPrompt.findIndex((item) => item.type !== 'systemPrompt');
    nextPrompt.splice(firstNonSystem === -1 ? nextPrompt.length : firstNonSystem, 0, system(text));
    return this.copy({ prompt: nextPrompt });
  }

  user(input: PromptInput): RequestBuilder {
    return this.copy({ prompt: [...this.state.prompt, ...toPromptItems(input)] });
  }

  assistant(text: string, toolCalls: ToolCall[] = []): RequestBuilder {
    return this.copy({ prompt: [...this.state.prompt, assistant(text, { toolCalls })] });
  }

  model(model: string): RequestBuilder {
    return this.copy({ model });
  }

  temperature(temperature: number): RequestBuilder {
    return this.copy({ temperature });
  }

  maxOutputTokens(maxOutputTokens: number): RequestBuilder {
    return this.copy({ maxOutputTokens });
  }

  tools(tools: ToolDefinition[], toolChoice: ToolChoice = 'auto'): RequestBuilder {
    return this.copy({ tools, toolChoice });
  }

  signal(signal: AbortSignal): RequestBuilder {
    return this.copy({ signal });
  }

  inspect(): GenerationRequest {
    return {
      prompt: this.state.prompt.map((item) => ({ ...item })),
      model: this.state.model,
      temperature: this.state.temperature,
      maxOutputTokens: this.state.maxOutputTokens,
      tools: this.state.tools,
      toolChoice: this.state.toolChoice,
      signal: this.state.signal,
      metadata: this.state.metadata,
    };
  }

  run(): Promise<GenerationResult> {
    return this.provider.generate(this.inspect());
  }

  async text(): Promise<string> {
    return resultText(await this.run());
  }

  async json<T = unknown>(parse?: (value: unknown) => T): Promise<T> {
    const result = await this.run();
    return parseJsonResult(result, parse);
  }

  async toolCalls(): Promise<ToolCall[]> {
    return resultToolCalls(await this.run());
  }
}

class ConversationImpl implements Conversation {
  private items: PromptItem[];
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(
    initial: PromptItem[],
    private readonly createRequest: (...inputs: PromptInput[]) => RequestBuilder,
  ) {
    this.items = initial;
  }

  ask(input: PromptInput, configure: ConfigureRequest = (request) => request): Promise<GenerationResult> {
    const execute = async () => {
      const additions = toPromptItems(input);
      const generation = this.generation;
      const result = await configure(this.createRequest(this.items, additions)).run();
      if (generation === this.generation) {
        this.items = [...this.items, ...additions, resultToPromptItem(result)];
      }
      return result;
    };
    const operation = this.queue.then(execute);
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async text(input: PromptInput, configure?: ConfigureRequest): Promise<string> {
    return resultText(await this.ask(input, configure));
  }

  async json<T = unknown>(input: PromptInput, parse?: (value: unknown) => T, configure?: ConfigureRequest): Promise<T> {
    return parseJsonResult(await this.ask(input, configure), parse);
  }

  async toolCalls(input: PromptInput, configure?: ConfigureRequest): Promise<ToolCall[]> {
    return resultToolCalls(await this.ask(input, configure));
  }

  history(): PromptItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  reset(...initial: PromptInput[]): void {
    this.generation += 1;
    this.items = prompt(...initial);
  }
}

export function genaicode(provider: ModelProvider, options: GenAIClientOptions = {}): GenAIClient {
  const { plugins = [], ...defaults } = options;
  const effectiveProvider = withPlugins(provider, plugins);
  const createRequest = (...inputs: PromptInput[]): RequestBuilder =>
    new RequestBuilderImpl(effectiveProvider, { ...defaults, prompt: prompt(...inputs) });
  return Object.assign((input: PromptInput) => createRequest(input), {
    prompt: createRequest,
    chain: (...initial: PromptInput[]) => new ConversationImpl(prompt(...initial), createRequest),
    provider: effectiveProvider,
  });
}

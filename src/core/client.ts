import { assistant, prompt, system, toPromptItems } from './prompt.js';
import { withPlugins, type GenAIPlugin } from './plugins.js';
import { parseJsonResult, resultText, resultToPromptItem, resultToolCalls } from './result.js';
import { providerStream, streamTextDeltas } from './stream.js';
import type {
  GenerationDefaults,
  GenerationRequest,
  GenerationResult,
  JsonResultParser,
  ModelProvider,
  PromptInput,
  PromptItem,
  ResponseFormat,
  StreamEvent,
  ThinkingConfig,
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
  /** Ask the provider for JSON (or a JSON schema) when supported. */
  responseFormat(format: ResponseFormat): RequestBuilder;
  /** Portable thinking / reasoning controls when the provider supports them. */
  thinking(thinking: ThinkingConfig): RequestBuilder;
  /** Ground the answer in the provider's own built-in web search, where supported. */
  search(enabled?: boolean): RequestBuilder;
  signal(signal: AbortSignal): RequestBuilder;
  run(): Promise<GenerationResult>;
  text(): Promise<string>;
  json<T = unknown>(parse?: JsonResultParser<T>): Promise<T>;
  toolCalls(): Promise<ToolCall[]>;
  /** Provider-neutral streaming events (native when available, synthesized otherwise). */
  stream(): AsyncIterable<StreamEvent>;
  /** Convenience: yield only text deltas. */
  streamText(): AsyncIterable<string>;
  inspect(): GenerationRequest;
}

export type ConfigureRequest = (request: RequestBuilder) => RequestBuilder;

export interface Conversation {
  ask(input: PromptInput, configure?: ConfigureRequest): Promise<GenerationResult>;
  text(input: PromptInput, configure?: ConfigureRequest): Promise<string>;
  json<T = unknown>(input: PromptInput, parse?: JsonResultParser<T>, configure?: ConfigureRequest): Promise<T>;
  toolCalls(input: PromptInput, configure?: ConfigureRequest): Promise<ToolCall[]>;
  stream(input: PromptInput, configure?: ConfigureRequest): AsyncIterable<StreamEvent>;
  streamText(input: PromptInput, configure?: ConfigureRequest): AsyncIterable<string>;
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

  responseFormat(responseFormat: ResponseFormat): RequestBuilder {
    return this.copy({ responseFormat });
  }

  thinking(thinking: ThinkingConfig): RequestBuilder {
    return this.copy({ thinking });
  }

  search(enabled = true): RequestBuilder {
    return this.copy({ search: enabled });
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
      responseFormat: this.state.responseFormat,
      thinking: this.state.thinking,
      search: this.state.search,
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

  async json<T = unknown>(parse?: JsonResultParser<T>): Promise<T> {
    const builder = this.state.responseFormat ? this : this.copy({ responseFormat: { type: 'json' } });
    return parseJsonResult(await builder.run(), parse);
  }

  async toolCalls(): Promise<ToolCall[]> {
    return resultToolCalls(await this.run());
  }

  stream(): AsyncIterable<StreamEvent> {
    return providerStream(this.provider, this.inspect());
  }

  streamText(): AsyncIterable<string> {
    return streamTextDeltas(this.stream());
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

  async json<T = unknown>(input: PromptInput, parse?: JsonResultParser<T>, configure?: ConfigureRequest): Promise<T> {
    return parseJsonResult(
      await this.ask(input, (request) => {
        const withJson = request.inspect().responseFormat ? request : request.responseFormat({ type: 'json' });
        return (configure ?? ((value) => value))(withJson);
      }),
      parse,
    );
  }

  async toolCalls(input: PromptInput, configure?: ConfigureRequest): Promise<ToolCall[]> {
    return resultToolCalls(await this.ask(input, configure));
  }

  stream(input: PromptInput, configure: ConfigureRequest = (request) => request): AsyncIterable<StreamEvent> {
    return this.iterateStream(input, configure);
  }

  private async *iterateStream(input: PromptInput, configure: ConfigureRequest): AsyncGenerator<StreamEvent> {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.queue;
    this.queue = previous.then(() => gate);
    await previous;

    try {
      const additions = toPromptItems(input);
      const generation = this.generation;
      const events = configure(this.createRequest(this.items, additions)).stream();
      let text = '';
      const toolCalls: ToolCall[] = [];
      const images: GenerationResult['parts'] = [];
      let usage: GenerationResult['usage'];
      let doneResult: GenerationResult | undefined;

      for await (const event of events) {
        yield event;
        switch (event.type) {
          case 'text-delta':
            text += event.text;
            break;
          case 'tool-call':
            toolCalls.push(event.toolCall);
            break;
          case 'image':
            images.push({ type: 'image', image: event.image });
            break;
          case 'usage':
            usage = event.usage;
            break;
          case 'done':
            doneResult = event.result;
            break;
          default:
            break;
        }
      }

      const result =
        doneResult ??
        ({
          parts: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...toolCalls.map((toolCall) => ({ type: 'toolCall' as const, toolCall })),
            ...images,
          ],
          usage,
        } satisfies GenerationResult);

      if (generation === this.generation) {
        this.items = [...this.items, ...additions, resultToPromptItem(result)];
      }
    } finally {
      release();
    }
  }

  streamText(input: PromptInput, configure?: ConfigureRequest): AsyncIterable<string> {
    return streamTextDeltas(this.stream(input, configure));
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

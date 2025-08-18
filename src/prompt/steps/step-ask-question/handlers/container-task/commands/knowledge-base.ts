import { FunctionDef, PromptItem } from '../../../../../../ai-service/common-types.js';
import { writeCache, readCache } from '../../../../../../files/cache-file.js';
import { CommandHandlerBaseProps, CommandHandlerResult } from '../container-commands-registry.js';

export const knowledgeBaseDef: FunctionDef = {
  name: 'knowledgeBase',
  description:
    'Manage a simple key-value knowledge base, stored in a cache. Useful for remembering information across commands.',
  parameters: {
    type: 'object',
    properties: {
      op: {
        type: 'string',
        description: 'Operation to perform: upsert, append, remove, or get.',
        enum: ['upsert', 'append', 'remove', 'get'],
      },
      namespace: {
        type: 'string',
        description: 'Optional namespace for the key.',
      },
      key: {
        type: 'string',
        description: 'The key for the knowledge base entry.',
      },
      value: {
        description: 'The JSON-serializable value to store (for upsert/append).',
      },
      tags: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Optional tags for easier retrieval or grouping.',
      },
    },
    required: ['op', 'key'],
  },
};

export type KnowledgeEntry = {
  key: string;
  value: unknown;
  tags?: string[];
  timestamp?: string; // ISO string
};

export type HandleKnowledgeBaseArgs = {
  /**
   * Operation to perform on the knowledge base
   * - upsert: insert or update value for a key
   * - append: push a value to an array under a key
   * - remove: delete a key from the KB
   * - get: retrieve a key from the KB
   */
  op: 'upsert' | 'append' | 'remove' | 'get';
  /** Namespacing for the KB entries, optional but recommended */
  namespace?: string;
  /** Key for the entry (required for upsert/append/remove/get) */
  key: string;
  /** Value to store (required for upsert/append) */
  value?: unknown;
  /** Optional tags to help retrieval */
  tags?: string[];
};

const KB_CACHE_KEY = 'containerTaskKnowledgeBase';

type KnowledgeBase = Record<string, unknown>;

function nsKey(namespace: string | undefined, key: string): string {
  return (namespace ? `${namespace}::` : '') + key;
}

export async function handleKnowledgeBase({
  actionResult,
  taskExecutionPrompt,
}: CommandHandlerBaseProps): Promise<CommandHandlerResult> {
  // Validate args shape
  const args = (actionResult.args ?? {}) as Partial<HandleKnowledgeBaseArgs>;
  const op = args.op;
  const key = args.key;

  if (!op || !key) {
    taskExecutionPrompt.push({
      type: 'user',
      functionResponses: [
        {
          name: 'knowledgeBase',
          call_id: actionResult.id || undefined,
          isError: true,
          content: 'Invalid knowledgeBase arguments: op and key are required',
        },
      ],
    });
    return { shouldBreakOuter: false, success: false, commandsExecutedIncrement: 0 };
  }

  const namespace = args.namespace;
  const fullKey = nsKey(namespace, key);

  const kb = readCache<KnowledgeBase>(KB_CACHE_KEY, {});

  let content: string;
  if (op === 'upsert') {
    const entry: KnowledgeEntry = {
      key: fullKey,
      value: args.value,
      tags: args.tags,
      timestamp: new Date().toISOString(),
    };
    kb[fullKey] = entry;
    writeCache(KB_CACHE_KEY, kb);
    content = `KB upsert OK for ${fullKey}`;
  } else if (op === 'append') {
    const valueArray = Array.isArray(kb[fullKey]) ? (kb[fullKey] as unknown[]) : [];
    valueArray.push(args.value);
    kb[fullKey] = valueArray;
    writeCache(KB_CACHE_KEY, kb);
    content = `KB append OK for ${fullKey} (size ${valueArray.length})`;
  } else if (op === 'remove') {
    if (fullKey in kb) {
      delete kb[fullKey];
      writeCache(KB_CACHE_KEY, kb);
      content = `KB remove OK for ${fullKey}`;
    } else {
      content = `KB key not found: ${fullKey}`;
    }
  } else if (op === 'get') {
    const existing = kb[fullKey];
    content = existing === undefined ? `KB miss for ${fullKey}` : JSON.stringify(existing);
  } else {
    content = `Unsupported operation: ${String(op)}`;
  }

  taskExecutionPrompt.push({
    type: 'user',
    functionResponses: [
      {
        name: 'knowledgeBase',
        call_id: actionResult.id || undefined,
        content,
      },
    ],
  } as PromptItem);

  return { shouldBreakOuter: false, success: true, commandsExecutedIncrement: 0 };
}

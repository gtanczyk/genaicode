# App Context Feature for GenAIcode Vite Plugin

## Overview

The App Context feature enables applications using the GenAIcode Vite plugin to provide contextual data to GenAIcode during development. This feature facilitates better code generation and analysis by allowing applications to share runtime state, configuration, and other relevant information with GenAIcode.

## Requirements

### Functional Requirements

1. **Context Storage**

   - Implement a key-value store for application context data
   - Support dynamic updates to stored context
   - Maintain context data persistence during development session

2. **Data Access**

   - Add new `pullAppContext` action type for retrieving stored context
   - Implement REST endpoint for context data transfer
   - Support future `pushAppContext` capability

3. **Integration**
   - Provide simple API for applications to update context
   - Enable TypeScript type safety for context operations
   - Maintain backward compatibility

### Technical Requirements

1. **Performance**

   - Minimal overhead for context updates
   - Efficient context data retrieval
   - Optimized data structure for frequent updates

2. **Type Safety**

   - TypeScript interfaces for context operations
   - Runtime type validation
   - Proper error handling

3. **Security**
   - Secure data transfer between app and GenAIcode
   - Input validation and sanitization
   - Access control for context operations

## Architecture

### Components

1. **Context Store Service**

```typescript
interface AppContextStore {
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  getAll(): Record<string, unknown>;
  clear(): void;
}
```

2. **Backend Endpoint**

```typescript
interface AppContextEndpoint {
  POST /api/context/:key    // Set context value
  GET /api/context/:key     // Get context value
  GET /api/context          // Get all context
  DELETE /api/context       // Clear context
}
```

3. **Frontend API**

```typescript
interface GenAIcodeContext {
  setContext(key: string, value: unknown): Promise<void>;
  getContext(key: string): Promise<unknown>;
  clearContext(): Promise<void>;
}
```

4. **Action Handler**

```typescript
interface PullAppContextAction {
  type: 'pullAppContext';
  key?: string; // Optional key, if not provided returns all context
}
```

## Implementation Details

### 1. Backend Implementation

1. Create Context Store Service

```typescript
// src/main/ui/backend/services/app-context-store.ts
export class AppContextStore {
  private store: Map<string, unknown> = new Map();

  set(key: string, value: unknown) {
    this.store.set(key, value);
  }

  get(key: string) {
    return this.store.get(key);
  }

  getAll() {
    return Object.fromEntries(this.store);
  }

  clear() {
    this.store.clear();
  }
}
```

2. Add REST Endpoint

```typescript
// src/main/ui/backend/endpoints/app-context-endpoint.ts
router.post('/api/context/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  contextStore.set(key, value);
  res.status(200).json({ success: true });
});
```

### 2. Frontend Integration

1. Vite Plugin Enhancement

```typescript
// src/vite-genaicode/vite-genaicode-plugin.ts
export interface ViteGenAIcodeOptions {
  context?: {
    initialData?: Record<string, unknown>;
  };
}
```

2. Context API Exposure

```typescript
// src/vite-genaicode/vite-genaicode-frontend.ts
window.genAIcode = {
  ...window.genAIcode,
  setContext: async (key, value) => {
    await fetch(`http://localhost:${port}/api/context/${key}`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    });
  },
};
```

### 3. Action Handler Implementation

1. Add Action Type

```typescript
// src/prompt/steps/step-ask-question/step-ask-question-types.ts
export type ActionType =
  | 'pullAppContext'
  | /* existing types */;
```

2. Implement Handler

```typescript
// src/prompt/steps/step-ask-question/handlers/handle-pull-app-context.ts
export async function handlePullAppContext(key?: string): Promise<Record<string, unknown>> {
  return key ? { [key]: await contextStore.get(key) } : await contextStore.getAll();
}
```

## Example Usage

### Setting Context in Application

```typescript
// Application code
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    // Update context when component mounts
    window.genAIcode?.setContext('userConfig', {
      theme: 'dark',
      language: 'typescript',
    });
  }, []);

  return <div>App Content</div>;
}
```

### Pulling Context in GenAIcode

```typescript
// In GenAIcode conversation
Assistant: Let me check the current application configuration.

<function_call>
{
  "name": "askQuestion",
  "args": {
    "actionType": "pullAppContext",
    "key": "userConfig"
  }
}
</function_call>

User: Context retrieved: { theme: 'dark', language: 'typescript' }
```

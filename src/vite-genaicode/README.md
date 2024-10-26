# Vite GenAIcode Plugin

A Vite plugin that brings GenAIcode's code generation capabilities into your development workflow.

## What it does

This plugin integrates GenAIcode multimodal AI coding assistant right into your Vite dev environment through a simple UI overlay. You can drag it around, hide it when you don't need it, and pull it up whenever you want AI assistance with your code.

![demo](media/demo-for-readme.gif 'demo')

## Quick Start

First, grab the package:

```bash
npm install --save-dev genaicode
```

Then add it to your Vite config:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import viteGenaicode from 'vite-genaicode';

export default defineConfig({
  plugins: [viteGenaicode()],
});
```

That's it - the plugin will spin up a server on port 1338 and add a floating button to your app in development mode.

## Configuration

Here's what you can tweak (all optional):

```typescript
viteGenaicode({
  // UI stuff
  uiPort: 1338, // Default port

  // AI behavior
  aiService: 'vertex-ai', // Or others like 'chat-gpt', 'anthropic', 'ai-studio', or custom
  temperature: 0.7, // Higher = more creative (default: 0.7)
  vision: true, // Enable vision capabilities (default: true)
  imagen: 'vertex-ai', // Enable image generation capabilities

  // Permissions
  allowFileCreate: true, // Let it create files (default: true)
  allowFileDelete: true, // Let it delete files (default: true)
  allowDirectoryCreate: true, // Let it create dirs (default: true)
  allowFileMove: true, // Let it move files (default: true)
});
```

See [CodegenOptions in codegen-types.ts](../main/codegen-types.ts) for full list of options.

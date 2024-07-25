#!/usr/bin/env node

const fs = require('fs');

const MONKEY_PATCH_FILE = '@google-cloud/vertexai/build/src/functions/generate_content.js';
const MONKEY_PATCH_TOOL_CONFIG = `// MONKEY PATCH TOOL_CONFIG`;

console.log('Apply vertex monkey patch');
const path = require.resolve(MONKEY_PATCH_FILE);
const content = fs.readFileSync(path, 'utf-8');
if (content.includes(MONKEY_PATCH_TOOL_CONFIG)) {
  console.log('Patch already applied');
  return;
}

const newContent = content.replaceAll(
  'data: generateContentRequest,',
  `// MONKEY PATCH TOOL_CONFIG
     data: {...generateContentRequest,tool_config: {function_calling_config: { mode: "ANY" }}},`,
);
fs.writeFileSync(path, newContent, 'utf-8');
console.log('Vertex monkey patch applied');

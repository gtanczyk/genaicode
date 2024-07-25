#!/usr/bin/env node

import('../src/ai-service/vertex-ai.js').then(({ applyVertexMonkeyPatch }) => applyVertexMonkeyPatch());

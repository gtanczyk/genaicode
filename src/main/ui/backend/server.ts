import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import express from 'express';

import { createRouter } from './api.js';
import { CodegenOptions } from '../../codegen-types.js';
import { Service } from './service.js';

export async function startServer(options: CodegenOptions) {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));

  const app = express();
  app.use(express.json());

  const service = new Service(options);
  const apiRouter = createRouter(service);

  // API routes
  app.use('/api', apiRouter);

  const vite = await createServer({
    build: {
      target: false,
      rollupOptions: {
        input: __dirname + '../frontend/index.html',
      },
    },
    configFile: false,
    root: __dirname + '../frontend',
    server: {
      middlewareMode: true,
    },
  });

  app.use(vite.middlewares);

  const server = app.listen(1337, () => {
    console.log('Server is running on http://localhost:1337');
  });

  server.on('error', console.error);
}

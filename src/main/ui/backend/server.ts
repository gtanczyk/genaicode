import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import http from 'http';

import { createRouter } from './api.js';
import './endpoints';
import { Service } from './service.js';

type ServerOptions = {
  uiPort: number;
  additionalFrameAncestors?: string[];
};

export async function startServer(service: Service, { uiPort, additionalFrameAncestors }: ServerOptions) {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));

  const app = express();

  // CORS configuration
  const corsOptions = {
    origin: `http://localhost:${uiPort}`,
    optionsSuccessStatus: 200,
  };
  app.use(cors(corsOptions));

  // Helmet for security headers including iframe protection
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'self'", 'vscode-webview:', 'vscode-file:', ...(additionalFrameAncestors ?? [])],
        },
      },
      referrerPolicy: {
        policy: 'strict-origin-when-cross-origin',
      },
      frameguard: false,
    }),
  );

  app.use(express.json());

  const apiRouter = createRouter(service);

  // API routes
  app.use('/api', apiRouter);

  const httpServer = http.createServer(app);
  httpServer.on('error', console.error);

  if (service.getCodegenOptions().isDev) {
    console.log('GenAIcode Dev Mode!');
    const { createServer } = await import('vite');
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
      plugins: [
        {
          name: 'security-token',
          transformIndexHtml: (html) => html.replace('__SECURITY_TOKEN__', service.getToken()),
        },
      ],
    });

    httpServer.on('error', () => vite.close());

    app.use(vite.middlewares);
  } else {
    // Serve index.html with injected token
    app.get('/', (_, res) => {
      const indexPath = path.join(__dirname, '../frontend/index.html');
      const html = fs.readFileSync(indexPath, 'utf-8').replace('__SECURITY_TOKEN__', service.getToken());
      res.send(html);
    });
    app.use('/assets', express.static(__dirname + '../frontend/assets'));
  }

  httpServer.listen(uiPort, () => {
    console.log(`Server is running on http://localhost:${uiPort}`);
  });
}

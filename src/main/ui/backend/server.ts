import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import express, { Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';

import { createRouter } from './api.js';
import { Service } from './service.js';

export async function startServer(service: Service) {
  const __dirname = fileURLToPath(new URL('.', import.meta.url));

  const app = express();

  // CORS configuration
  const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : 'http://localhost:1337',
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
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      referrerPolicy: {
        policy: 'strict-origin-when-cross-origin',
      },
      frameguard: {
        action: 'deny',
      },
    }),
  );

  app.use(express.json());

  // Serve index.html with injected token
  app.get('/', (_, res: Response, next: NextFunction) => {
    const indexPath = path.join(__dirname, '../frontend/index.html');
    fs.readFile(indexPath, 'utf-8', (err, html) => {
      if (err) {
        return next(err);
      }
      const injectedHtml = html.replace('__SECURITY_TOKEN__', service.getToken());
      res.send(injectedHtml);
    });
  });

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

import express from 'express';
import { Service } from './service.js';
import { handlers } from './api-handlers.js';
import './endpoints/index.js';

export function createRouter(service: Service) {
  const router = express.Router();

  // Apply token validation middleware to all routes
  router.use((req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (!service.validateToken(token)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next();
  });

  // Middleware to parse JSON bodies, needed for answer-question with actionType
  router.use(express.json());

  // Register all endpoints
  for (const handler of handlers) {
    handler(router, service);
  }

  return router;
}

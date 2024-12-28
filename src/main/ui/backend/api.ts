import express, { Router } from 'express';
import { Service } from './service.js';

type EndpointHandler = (router: Router, service: Service) => void;

const handlers: EndpointHandler[] = [];

export function registerEndpoint(handler: EndpointHandler) {
  handlers.push(handler);
}

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

  // Register all endpoints
  for (const handler of handlers) {
    handler(router, service);
  }

  return router;
}

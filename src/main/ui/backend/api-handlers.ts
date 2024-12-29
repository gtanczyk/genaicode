import { Router } from 'express';
import { Service } from './service.js';

type EndpointHandler = (router: Router, service: Service) => void;

export const handlers: EndpointHandler[] = [];

export function registerEndpoint(handler: EndpointHandler) {
  handlers.push(handler);
}

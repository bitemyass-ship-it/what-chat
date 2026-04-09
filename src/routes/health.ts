import { Router, type RequestHandler } from 'express';
import type { Logger } from '../types/whatsapp';

export const createHealthHandler = (logger: Logger): RequestHandler => (_request, response) => {
  logger.info('Health check requested');
  response.status(200).json({
    service: 'whatsapp-monitor',
    status: 'ok'
  });
};

export const createHealthRouter = (logger: Logger): Router => {
  const router = Router();

  router.get('/health', createHealthHandler(logger));

  return router;
};

import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../types/whatsapp';

export const AUTH_PASSWORD_HEADER = 'X-User-Password';

const UNAUTHORIZED_RESPONSE = {
  error: 'Unauthorized'
} as const;

const createMd5Hash = (value: string): string =>
  createHash('md5').update(value).digest('hex');

interface CreateAuthMiddlewareOptions {
  configuredPassword: string;
  logger: Logger;
}

export const createAuthMiddleware = ({
  configuredPassword,
  logger
}: CreateAuthMiddlewareOptions): RequestHandler => (request, response, next) => {
  const receivedPassword = request.get(AUTH_PASSWORD_HEADER);

  if (
    receivedPassword === undefined ||
    receivedPassword.trim() === '' ||
    createMd5Hash(receivedPassword) !== createMd5Hash(configuredPassword)
  ) {
    logger.warn('Authentication failed', {
      ip: request.ip,
      method: request.method,
      route: request.originalUrl
    });
    response.status(401).json(UNAUTHORIZED_RESPONSE);
    return;
  }

  next();
};

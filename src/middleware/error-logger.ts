import type { ErrorRequestHandler } from 'express';
import type { Logger } from '../types/whatsapp';

interface ErrorLoggerOptions {
  logger: Logger;
}

export const createErrorLogger = ({
  logger
}: ErrorLoggerOptions): ErrorRequestHandler =>
  (error, request, response, next) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack ?? null : null;

    logger.error('Unhandled route error', {
      error: errorMessage,
      stack,
      context: {
        method: request.method,
        url: request.originalUrl || request.url,
        ip: request.ip ?? request.socket.remoteAddress ?? 'unknown'
      }
    });

    if (response.headersSent) {
      next(error);
      return;
    }

    response.status(500).json({ error: 'Internal Server Error' });
  };

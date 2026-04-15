import type { RequestHandler } from 'express';
import type { Logger } from '../types/whatsapp';

interface HttpRequestLoggerOptions {
  logger: Logger;
}

export const createHttpRequestLogger = ({
  logger
}: HttpRequestLoggerOptions): RequestHandler =>
  (request, response, next) => {
    const startTime = Date.now();

    response.on('finish', () => {
      const durationMs = Date.now() - startTime;

      logger.http({
        method: request.method,
        url: request.originalUrl || request.url,
        status: response.statusCode,
        durationMs,
        ip: request.ip ?? request.socket.remoteAddress ?? 'unknown',
        contentLength: Number(response.getHeader('content-length')) || undefined,
        userAgent: request.headers['user-agent']
      });
    });

    next();
  };

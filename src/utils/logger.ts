import type { Logger } from '../types/whatsapp';

const write = (
  method: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>
): void => {
  if (meta) {
    console[method](message, meta);
    return;
  }

  console[method](message);
};

export const createLogger = (): Logger => ({
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta)
});

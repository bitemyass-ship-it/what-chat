import type { Logger } from '../types/whatsapp';

export interface HealthLogger {
  stop(): void;
}

interface StartHealthLoggerOptions {
  intervalMs: number;
  logger: Logger;
}

const collectHealthSnapshot = (): {
  memory: { external: number; heapTotal: number; heapUsed: number; rss: number };
  memoryMb: { heapTotal: number; heapUsed: number; rss: number };
  uptimeSeconds: number;
} => {
  const mem = process.memoryUsage();

  return {
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external
    },
    memoryMb: {
      rss: Math.round((mem.rss / 1_048_576) * 10) / 10,
      heapUsed: Math.round((mem.heapUsed / 1_048_576) * 10) / 10,
      heapTotal: Math.round((mem.heapTotal / 1_048_576) * 10) / 10
    }
  };
};

export const startHealthLogger = ({
  intervalMs,
  logger
}: StartHealthLoggerOptions): HealthLogger => {
  const emit = (): void => {
    logger.health(collectHealthSnapshot());
  };

  emit();
  const intervalId = setInterval(emit, intervalMs);

  return {
    stop(): void {
      clearInterval(intervalId);
    }
  };
};

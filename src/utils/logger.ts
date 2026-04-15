import fs from 'node:fs';
import path from 'node:path';
import type { HealthLogEntry, HttpLogEntry, Logger } from '../types/whatsapp';
import { findProjectRoot } from './project-root';

type LogLevel = 'error' | 'info' | 'warn';
type LogCategory = 'app' | 'error' | 'health' | 'http';

interface LogEntry {
  category: LogCategory;
  level: LogLevel;
  message: string;
  pid: number;
  timestamp: string;
  [key: string]: unknown;
}

interface CreateLoggerOptions {
  env?: NodeJS.ProcessEnv;
  logDir?: string;
}

const resolveLogDir = ({
  env = process.env,
  logDir
}: CreateLoggerOptions): string | null => {
  const isProduction = env.NODE_ENV === 'production';
  const dirValue = logDir ?? env.LOG_DIR;

  if (!dirValue) {
    if (isProduction) {
      throw new Error('LOG_DIR is required for production');
    }

    return path.join(findProjectRoot(__dirname), 'logs');
  }

  const trimmed = dirValue.trim();

  if (isProduction && !path.isAbsolute(trimmed)) {
    throw new Error('LOG_DIR must be an absolute path for production');
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  return path.join(findProjectRoot(__dirname), trimmed);
};

const buildEntry = (
  level: LogLevel,
  category: LogCategory,
  message: string,
  extra?: Record<string, unknown>
): LogEntry => {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    pid: process.pid,
    message
  };

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (!(key in entry)) {
        entry[key] = value;
      }
    }
  }

  return entry;
};

const toJsonLine = (entry: LogEntry): string =>
  JSON.stringify(entry) + '\n';

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  let logDir: string | null = null;

  try {
    logDir = resolveLogDir(options);
  } catch (error) {
    if (options.env?.NODE_ENV === 'production' || process.env.NODE_ENV === 'production') {
      throw error;
    }
  }

  const streams: Map<LogCategory, fs.WriteStream> = new Map();

  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });

    const categories: LogCategory[] = ['app', 'error', 'health', 'http'];

    for (const category of categories) {
      const stream = fs.createWriteStream(
        path.join(logDir, `${category}.log`),
        { flags: 'a' }
      );

      stream.on('error', (err) => {
        process.stderr.write(
          `[logger] Failed to write to ${category}.log: ${err.message}\n`
        );
      });

      streams.set(category, stream);
    }
  }

  const writeToFile = (category: LogCategory, line: string): void => {
    const stream = streams.get(category);

    if (!stream) {
      return;
    }

    try {
      stream.write(line);
    } catch {
      // Handled by stream error listener
    }
  };

  const writeToConsole = (
    level: LogLevel,
    line: string
  ): void => {
    console[level](line.trimEnd());
  };

  const writeLog = (
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: Record<string, unknown>
  ): void => {
    const entry = buildEntry(level, category, message, meta);
    const line = toJsonLine(entry);

    writeToConsole(level, line);
    writeToFile(category, line);
  };

  return {
    info(message: string, meta?: Record<string, unknown>): void {
      writeLog('info', 'app', message, meta);
    },

    warn(message: string, meta?: Record<string, unknown>): void {
      writeLog('warn', 'app', message, meta);
    },

    error(message: string, meta?: Record<string, unknown>): void {
      const entry = buildEntry('error', 'app', message, meta);
      const line = toJsonLine(entry);

      writeToConsole('error', line);
      writeToFile('app', line);

      const errorEntry: LogEntry = {
        ...entry,
        category: 'error',
        error: meta?.error as string ?? message,
        stack: meta?.stack as string ?? null,
        context: meta?.context ?? null
      };
      const errorLine = toJsonLine(errorEntry);

      writeToFile('error', errorLine);
    },

    http(entry: HttpLogEntry): void {
      const logEntry = buildEntry(
        'info',
        'http',
        `${entry.method} ${entry.url} ${entry.status} ${entry.durationMs}ms`,
        {
          method: entry.method,
          url: entry.url,
          status: entry.status,
          durationMs: entry.durationMs,
          ip: entry.ip,
          contentLength: entry.contentLength,
          userAgent: entry.userAgent
        }
      );
      const line = toJsonLine(logEntry);

      writeToConsole('info', line);
      writeToFile('http', line);
    },

    health(entry: HealthLogEntry): void {
      const logEntry = buildEntry('info', 'health', 'Process health snapshot', {
        uptimeSeconds: entry.uptimeSeconds,
        memory: entry.memory,
        memoryMb: entry.memoryMb
      });
      const line = toJsonLine(logEntry);

      writeToConsole('info', line);
      writeToFile('health', line);
    },

    close(): void {
      for (const stream of streams.values()) {
        stream.end();
      }

      streams.clear();
    }
  };
};

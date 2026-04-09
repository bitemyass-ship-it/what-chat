import express, { type ErrorRequestHandler, type Express } from 'express';
import type {
  ChatsRepository,
  EmployeesRepository,
  MessagesRepository
} from './database/types';
import { createAuthMiddleware } from './middleware/auth';
import { createAuthRouter } from './routes/auth';
import { createEmployeesRouter } from './routes/employees';
import type { Logger, SessionManager } from './types/whatsapp';

export interface AppReadinessStatus {
  activeRuntimeSessionCount: number;
  chatSyncSchedulerEnabled: boolean;
  chatSyncSchedulerReady: boolean;
  databaseReady: boolean;
  failedRestoreCount: number;
  httpAppReady: boolean;
  sessionActivityLoopReady: boolean;
  sessionRestoreCompleted: boolean;
}

export interface AppReadinessReporter {
  getStatus(): AppReadinessStatus;
}

interface CreateAppOptions {
  authPassword: string;
  chats: ChatsRepository;
  employees: EmployeesRepository;
  logger: Logger;
  messages: MessagesRepository;
  readiness?: AppReadinessReporter;
  sessionManager: SessionManager;
}

const DEFAULT_READINESS_STATUS: AppReadinessStatus = {
  activeRuntimeSessionCount: 0,
  chatSyncSchedulerEnabled: false,
  chatSyncSchedulerReady: false,
  databaseReady: false,
  failedRestoreCount: 0,
  httpAppReady: false,
  sessionActivityLoopReady: false,
  sessionRestoreCompleted: false
};

const isReadyForFirstMode = (status: AppReadinessStatus): boolean =>
  status.databaseReady &&
  status.httpAppReady &&
  status.sessionActivityLoopReady &&
  status.chatSyncSchedulerReady &&
  status.chatSyncSchedulerEnabled &&
  status.sessionRestoreCompleted;

export const createApp = ({
  authPassword,
  chats,
  employees,
  logger,
  messages,
  readiness,
  sessionManager
}: CreateAppOptions): Express => {
  const app = express();
  const authMiddleware = createAuthMiddleware({
    configuredPassword: authPassword,
    logger
  });
  const handleJsonParseError: ErrorRequestHandler = (error, _request, response, next) => {
    if (
      error instanceof SyntaxError &&
      'status' in error &&
      error.status === 400 &&
      'body' in error
    ) {
      logger.warn('Malformed JSON request body');
      response.status(400).json({
        error: 'Malformed JSON body'
      });
      return;
    }

    next(error);
  };

  app.disable('x-powered-by');
  app.get('/health', (_request, response) => {
    logger.info('Health check requested');
    response.status(200).send('ok');
  });
  app.get('/ready', (_request, response) => {
    const readinessStatus = readiness?.getStatus() ?? DEFAULT_READINESS_STATUS;
    const ready = isReadyForFirstMode(readinessStatus);

    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'not_ready',
      ...readinessStatus
    });
  });
  app.use(createAuthRouter({
    authMiddleware
  }));
  app.use('/employees', authMiddleware);
  app.use(express.json());
  app.use(createEmployeesRouter({
    chats,
    employees,
    logger,
    messages,
    sessionManager
  }));
  app.use(handleJsonParseError);

  return app;
};

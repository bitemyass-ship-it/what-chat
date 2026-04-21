import type { Express } from 'express';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough, Writable } from 'node:stream';
import { createApp } from '../src/app';
import { createDatabase } from '../src/database/database';
import type { Database } from '../src/database/types';
import { AUTH_PASSWORD_HEADER } from '../src/middleware/auth';
import {
  createReportExportService,
  type ReportExportChildProcess,
  type ReportExportService,
  type SpawnReportExportWorker
} from '../src/reports/report-export-service';
import type {
  Logger,
  SessionHealth,
  SessionManager,
  WhatsappClientFactory,
  WhatsappSessionClient
} from '../src/types/whatsapp';
import { createSessionManager as createRealSessionManager } from '../src/whatsapp/manager';

interface RequestOptions {
  body?: string;
  headers?: Record<string, string>;
  method: string;
  path: string;
}

interface ResponseResult {
  body: string;
  headers: Record<string, string>;
  status: number;
}

type ExpressHandler = (request: unknown, response: unknown) => void;

const AUTH_PASSWORD = 'super-secret-password';
const AUTH_HEADERS = {
  [AUTH_PASSWORD_HEADER]: AUTH_PASSWORD
};
const formatReportPeriod = (date: Date): string =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
const createReportPeriodDate = (monthOffset: number): Date => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1, 0, 0, 0, 0);
};
const CURRENT_REPORT_PERIOD = formatReportPeriod(createReportPeriodDate(0));
const NEXT_REPORT_PERIOD = formatReportPeriod(createReportPeriodDate(1));

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
});

const buildSessionHealth = (
  overrides: Partial<SessionHealth> & Pick<SessionHealth, 'employeeId'> = {
    employeeId: 'unknown'
  }
): SessionHealth => {
  const { employeeId, ...rest } = overrides;

  return {
    employeeId,
    hasRuntimeSession: false,
    isSessionActive: false,
    lastCheckedAt: null,
    lastDisconnectReason: null,
    lastError: null,
    lastEventAt: null,
    lastReadyAt: null,
    qrCode: null,
    runtimeStatus: 'not_started',
    whatsappState: null,
    ...rest
  };
};

const createMockSessionManager = (): SessionManager => ({
  getSessionHealth: jest.fn().mockResolvedValue(buildSessionHealth()),
  shutdown: jest.fn().mockResolvedValue(undefined),
  startAll: jest.fn().mockResolvedValue(undefined),
  startSession: jest.fn().mockResolvedValue(undefined),
  stopSession: jest.fn().mockResolvedValue(undefined)
});

const createMockReportExportService = (): ReportExportService => ({
  startExport: jest.fn(() => ({
    alreadyRunning: false,
    status: 'accepted'
  }))
});

const createMockReportExportChildProcess = (): ReportExportChildProcess => {
  const child = new EventEmitter() as EventEmitter & {
    pid?: number;
    unref: jest.Mock;
  };

  child.pid = 123;
  child.unref = jest.fn();

  return child as ReportExportChildProcess;
};

const createWhatsappClient = (): WhatsappSessionClient => ({
  destroy: jest.fn().mockResolvedValue(undefined),
  getContactLidAndPhone: jest.fn().mockResolvedValue([]),
  getState: jest.fn().mockResolvedValue('CONNECTED'),
  initialize: jest.fn().mockResolvedValue(undefined),
  on: jest.fn()
});

const performRequest = async (
  app: Express,
  { body, headers = {}, method, path }: RequestOptions
): Promise<ResponseResult> => {
  const request = new PassThrough() as PassThrough & {
    connection: Record<string, unknown>;
    headers: Record<string, string>;
    httpVersion: string;
    httpVersionMajor: number;
    httpVersionMinor: number;
    method: string;
    socket: Record<string, unknown>;
    url: string;
  };
  const requestHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );

  if (body !== undefined && requestHeaders['content-length'] === undefined) {
    requestHeaders['content-length'] = String(Buffer.byteLength(body));
  }

  request.connection = {};
  request.headers = requestHeaders;
  request.httpVersion = '1.1';
  request.httpVersionMajor = 1;
  request.httpVersionMinor = 1;
  request.method = method;
  request.socket = {};
  request.url = path;

  const responseHeaders = new Map<string, string>();
  const responseChunks: Buffer[] = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      responseChunks.push(Buffer.from(chunk));
      callback();
    }
  }) as Writable & {
    finished: boolean;
    getHeader(name: string): string | undefined;
    getHeaderNames(): string[];
    getHeaders(): Record<string, string>;
    hasHeader(name: string): boolean;
    headersSent: boolean;
    locals: Record<string, unknown>;
    removeHeader(name: string): void;
    req: typeof request;
    setHeader(name: string, value: unknown): void;
    statusCode: number;
    write(chunk: string | Uint8Array): boolean;
    writeHead(
      statusCode: number,
      statusMessage?: string | Record<string, unknown>,
      headers?: Record<string, unknown>
    ): typeof response;
    end(chunk?: string | Uint8Array): typeof response;
  };

  response.finished = false;
  response.headersSent = false;
  response.locals = {};
  response.req = request;
  response.statusCode = 200;
  response.setHeader = (name: string, value: unknown): void => {
    responseHeaders.set(
      name.toLowerCase(),
      Array.isArray(value) ? value.join(', ') : String(value)
    );
  };
  response.getHeader = (name: string): string | undefined =>
    responseHeaders.get(name.toLowerCase());
  response.getHeaderNames = (): string[] => Array.from(responseHeaders.keys());
  response.getHeaders = (): Record<string, string> => Object.fromEntries(responseHeaders);
  response.hasHeader = (name: string): boolean => responseHeaders.has(name.toLowerCase());
  response.removeHeader = (name: string): void => {
    responseHeaders.delete(name.toLowerCase());
  };
  response.writeHead = (
    statusCode: number,
    statusMessage?: string | Record<string, unknown>,
    headersArg?: Record<string, unknown>
  ): typeof response => {
    response.statusCode = statusCode;
    const outgoingHeaders =
      typeof statusMessage === 'string' ? headersArg : statusMessage;

    if (outgoingHeaders) {
      for (const [name, value] of Object.entries(outgoingHeaders)) {
        response.setHeader(name, value);
      }
    }

    return response;
  };

  const writableWrite = response.write.bind(response);
  response.write = ((chunk: string | Uint8Array): boolean => {
    response.headersSent = true;
    writableWrite(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    return true;
  }) as typeof response.write;
  response.end = ((chunk?: string | Uint8Array): typeof response => {
    if (chunk !== undefined) {
      response.write(chunk);
    }

    response.headersSent = true;
    response.finished = true;
    response.emit('finish');
    return response;
  }) as typeof response.end;

  await new Promise<void>((resolve, reject) => {
    response.on('finish', () => {
      resolve();
    });
    response.on('error', reject);

    try {
      if (body === undefined) {
        request.push(null);
      } else {
        request.push(body);
        request.push(null);
      }

      (app as unknown as ExpressHandler)(request, response);
    } catch (error) {
      reject(error);
    }
  });

  return {
    body: Buffer.concat(responseChunks).toString('utf8'),
    headers: Object.fromEntries(responseHeaders),
    status: response.statusCode
  };
};

const performProtectedRequest = async (
  app: Express,
  options: RequestOptions
): Promise<ResponseResult> =>
  performRequest(app, {
    ...options,
    headers: {
      ...AUTH_HEADERS,
      ...(options.headers ?? {})
    }
  });

describe('app wiring', () => {
  let app: Express | undefined;
  let database: Database | undefined;
  let logger: Logger | undefined;
  let removeSessionDirectorySpy: jest.SpiedFunction<typeof fs.rm> | undefined;
  let sessionManager: SessionManager | undefined;

  beforeEach(() => {
    removeSessionDirectorySpy = jest.spyOn(fs, 'rm').mockResolvedValue(undefined);
    logger = createLogger();
    database = createDatabase({
      databasePath: ':memory:',
      logger
    });
    sessionManager = createMockSessionManager();
    app = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database.chats,
      employees: database.employees,
      logger,
      messages: database.messages,
      sessionManager
    });
  });

  afterEach(() => {
    removeSessionDirectorySpy?.mockRestore();
    removeSessionDirectorySpy = undefined;
    database?.close();
    app = undefined;
    database = undefined;
    logger = undefined;
    sessionManager = undefined;
  });

  it('should keep health endpoint working after mounting employee routes', async () => {
    const response = await performRequest(app as Express, {
      method: 'GET',
      path: '/health'
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe('ok');
  });

  it('should report not ready when the first-mode readiness contract is incomplete', async () => {
    const readinessApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      readiness: {
        getStatus: () => ({
          activeRuntimeSessionCount: 1,
          chatSyncSchedulerEnabled: false,
          chatSyncSchedulerReady: false,
          databaseReady: true,
          failedRestoreCount: 0,
          httpAppReady: true,
          sessionActivityLoopReady: true,
          sessionRestoreCompleted: true
        })
      },
      sessionManager: sessionManager as SessionManager
    });
    const response = await performRequest(readinessApp, {
      method: 'GET',
      path: '/ready'
    });

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      activeRuntimeSessionCount: 1,
      chatSyncSchedulerEnabled: false,
      chatSyncSchedulerReady: false,
      databaseReady: true,
      failedRestoreCount: 0,
      httpAppReady: true,
      sessionActivityLoopReady: true,
      sessionRestoreCompleted: true,
      status: 'not_ready'
    });
  });

  it('should report ready when the first-mode readiness contract is satisfied', async () => {
    const readinessApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      readiness: {
        getStatus: () => ({
          activeRuntimeSessionCount: 2,
          chatSyncSchedulerEnabled: true,
          chatSyncSchedulerReady: true,
          databaseReady: true,
          failedRestoreCount: 0,
          httpAppReady: true,
          sessionActivityLoopReady: true,
          sessionRestoreCompleted: true
        })
      },
      sessionManager: sessionManager as SessionManager
    });
    const response = await performRequest(readinessApp, {
      method: 'GET',
      path: '/ready'
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      activeRuntimeSessionCount: 2,
      chatSyncSchedulerEnabled: true,
      chatSyncSchedulerReady: true,
      databaseReady: true,
      failedRestoreCount: 0,
      httpAppReady: true,
      sessionActivityLoopReady: true,
      sessionRestoreCompleted: true,
      status: 'ok'
    });
  });

  it('should confirm auth when the shared password is correct', async () => {
    const response = await performProtectedRequest(app as Express, {
      method: 'GET',
      path: '/auth/check'
    });

    expect(response.status).toBe(204);
    expect(response.body).toBe('');
  });

  it('should reject auth check when the shared password is incorrect', async () => {
    const response = await performRequest(app as Express, {
      headers: {
        [AUTH_PASSWORD_HEADER]: 'wrong-password'
      },
      method: 'GET',
      path: '/auth/check'
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Unauthorized'
    });
  });

  it('should reject protected routes when the auth header is missing', async () => {
    const response = await performRequest(app as Express, {
      method: 'GET',
      path: '/employees'
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Unauthorized'
    });
  });

  it('should mount employee routes on the protected app', async () => {
    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });

    const response = await performProtectedRequest(app as Express, {
      method: 'GET',
      path: '/employees'
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual([
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna'
      })
    ]);
  });

  it('should mount the employee chats route on the protected app', async () => {
    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });

    const response = await performProtectedRequest(app as Express, {
      method: 'GET',
      path: '/employees/anna/chats'
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1
    });
  });

  it('should reject report export when the auth header is missing without starting export', async () => {
    const reportExportService = createMockReportExportService();
    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: ':memory:',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    const response = await performRequest(reportApp, {
      method: 'POST',
      path: `/reports/anna/${NEXT_REPORT_PERIOD}`
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Unauthorized'
    });
    expect(reportExportService.startExport).not.toHaveBeenCalled();
  });

  it('should reject report export when the auth header is invalid without starting export', async () => {
    const reportExportService = createMockReportExportService();
    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: ':memory:',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    const response = await performRequest(reportApp, {
      headers: {
        [AUTH_PASSWORD_HEADER]: 'wrong-password'
      },
      method: 'POST',
      path: `/reports/anna/${NEXT_REPORT_PERIOD}`
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Unauthorized'
    });
    expect(reportExportService.startExport).not.toHaveBeenCalled();
  });

  it('should accept a valid report export POST and start the child export service', async () => {
    const reportExportService = createMockReportExportService();
    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: '/tmp/what-chat.sqlite',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });

    const response = await performProtectedRequest(reportApp, {
      method: 'POST',
      path: `/reports/anna/${CURRENT_REPORT_PERIOD}`
    });

    expect(response.status).toBe(202);
    expect(JSON.parse(response.body)).toEqual({
      status: 'accepted'
    });
    expect(reportExportService.startExport).toHaveBeenCalledWith({
      databasePath: '/tmp/what-chat.sqlite',
      employeeCode: 'anna',
      period: CURRENT_REPORT_PERIOD,
      reportsDir: '/tmp/reports',
      targetFilePath: `/tmp/reports/employees/anna/anna-${CURRENT_REPORT_PERIOD}.csv`
    });
  });

  it('should return 404 for report export when the employee does not exist', async () => {
    const reportExportService = createMockReportExportService();
    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: ':memory:',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    const response = await performProtectedRequest(reportApp, {
      method: 'POST',
      path: `/reports/anna/${CURRENT_REPORT_PERIOD}`
    });

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Employee not found: anna'
    });
    expect(reportExportService.startExport).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid report export period', async () => {
    const reportExportService = createMockReportExportService();
    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: ':memory:',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    database?.employees.create({
      code: 'anna'
    });

    const response = await performProtectedRequest(reportApp, {
      method: 'POST',
      path: '/reports/anna/202613'
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'period route parameter must use YYYYMM format'
    });
    expect(reportExportService.startExport).not.toHaveBeenCalled();
  });

  it('should return 400 for future report export period', async () => {
    const reportExportService = createMockReportExportService();
    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: ':memory:',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    database?.employees.create({
      code: 'anna'
    });

    const response = await performProtectedRequest(reportApp, {
      method: 'POST',
      path: `/reports/anna/${NEXT_REPORT_PERIOD}`
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'period must not be in the future'
    });
    expect(reportExportService.startExport).not.toHaveBeenCalled();
  });

  it('should return 400 for empty report export employee code', async () => {
    const reportExportService = createMockReportExportService();
    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: ':memory:',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    const response = await performProtectedRequest(reportApp, {
      method: 'POST',
      path: `/reports/%20/${CURRENT_REPORT_PERIOD}`
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: 'employeeCode route parameter is required'
    });
    expect(reportExportService.startExport).not.toHaveBeenCalled();
  });

  it('should return 500 when report export child process cannot be started', async () => {
    const reportExportService = createMockReportExportService();

    (reportExportService.startExport as jest.Mock).mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });

    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: ':memory:',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    database?.employees.create({
      code: 'anna'
    });

    const response = await performProtectedRequest(reportApp, {
      method: 'POST',
      path: `/reports/anna/${CURRENT_REPORT_PERIOD}`
    });

    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Failed to start report export'
    });
  });

  it('should keep duplicate in-flight report exports idempotent', async () => {
    const spawnWorker = jest.fn(
      (_input: Parameters<SpawnReportExportWorker>[0]) =>
        createMockReportExportChildProcess()
    );
    const reportExportService = createReportExportService({
      logger: logger as Logger,
      spawnWorker
    });
    const reportApp = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database?.chats as Database['chats'],
      databasePath: '/tmp/what-chat.sqlite',
      employees: database?.employees as Database['employees'],
      logger: logger as Logger,
      messages: database?.messages as Database['messages'],
      reportExportService,
      reportsDir: '/tmp/reports',
      sessionManager: sessionManager as SessionManager
    });

    database?.employees.create({
      code: 'anna'
    });

    const firstResponse = await performProtectedRequest(reportApp, {
      method: 'POST',
      path: `/reports/anna/${CURRENT_REPORT_PERIOD}`
    });
    const secondResponse = await performProtectedRequest(reportApp, {
      method: 'POST',
      path: `/reports/anna/${CURRENT_REPORT_PERIOD}`
    });

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(JSON.parse(firstResponse.body)).toEqual({
      status: 'accepted'
    });
    expect(JSON.parse(secondResponse.body)).toEqual({
      status: 'accepted'
    });
    expect(spawnWorker).toHaveBeenCalledTimes(1);
  });

  it('should mount the employee chat messages route on the protected app', async () => {
    database?.employees.create({
      code: 'anna',
      displayName: 'Anna'
    });
    const chat = database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });

    const response = await performProtectedRequest(app as Express, {
      method: 'GET',
      path: `/employees/anna/chats/${chat?.id}/messages`
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1
    });
  });

  it('should expose employee session health through the protected app', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: true,
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        lastCheckedAt: '2026-03-29T20:00:00.000Z',
        lastEventAt: '2026-03-29T19:59:00.000Z',
        lastReadyAt: '2026-03-29T19:58:00.000Z',
        runtimeStatus: 'ready',
        whatsappState: 'CONNECTED'
      })
    );

    const response = await performProtectedRequest(app as Express, {
      method: 'GET',
      path: '/employees/anna/health'
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      whatsappActive: true
    });
    expect(sessionManager?.getSessionHealth).toHaveBeenCalledWith('anna');
  });

  it('should return 404 for employee health when the employee does not exist', async () => {
    const response = await performProtectedRequest(app as Express, {
      method: 'GET',
      path: '/employees/missing/health'
    });

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Employee not found: missing'
    });
    expect(sessionManager?.getSessionHealth).not.toHaveBeenCalled();
  });

  it('should activate a WhatsApp session through the protected app', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: true,
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock)
      .mockResolvedValueOnce(
        buildSessionHealth({
          employeeId: 'anna'
        })
      )
      .mockResolvedValueOnce(
        buildSessionHealth({
          employeeId: 'anna',
          hasRuntimeSession: true,
          lastCheckedAt: '2026-03-29T20:00:00.000Z',
          runtimeStatus: 'starting'
        })
      );

    const response = await performProtectedRequest(app as Express, {
      method: 'POST',
      path: '/employees/anna/whatsapp-session'
    });

    expect(response.status).toBe(202);
    expect(JSON.parse(response.body)).toEqual({
      employeeId: 'anna',
      hasRuntimeSession: true,
      whatsappActive: false,
      runtimeStatus: 'starting',
      whatsappState: null,
      qrCode: null,
      lastError: null,
      lastDisconnectReason: null,
      lastEventAt: null,
      lastReadyAt: null,
      lastCheckedAt: '2026-03-29T20:00:00.000Z'
    });
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
    expect(sessionManager?.startSession).toHaveBeenCalledWith('anna');
  });

  it('should keep WhatsApp session activation idempotent through the protected app', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: true,
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        lastCheckedAt: '2026-03-29T20:00:00.000Z',
        runtimeStatus: 'waiting_for_qr',
        qrCode: 'raw-qr-code'
      })
    );

    const response = await performProtectedRequest(app as Express, {
      method: 'POST',
      path: '/employees/anna/whatsapp-session'
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      employeeId: 'anna',
      hasRuntimeSession: true,
      whatsappActive: false,
      runtimeStatus: 'waiting_for_qr',
      whatsappState: null,
      qrCode: 'raw-qr-code',
      lastError: null,
      lastDisconnectReason: null,
      lastEventAt: null,
      lastReadyAt: null,
      lastCheckedAt: '2026-03-29T20:00:00.000Z'
    });
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
  });

  it('should allow WhatsApp session activation for inactive employees', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: false,
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock)
      .mockResolvedValueOnce(
        buildSessionHealth({
          employeeId: 'anna'
        })
      )
      .mockResolvedValueOnce(
        buildSessionHealth({
          employeeId: 'anna',
          hasRuntimeSession: true,
          lastCheckedAt: '2026-03-29T20:00:00.000Z',
          runtimeStatus: 'starting'
        })
      );

    const response = await performProtectedRequest(app as Express, {
      method: 'POST',
      path: '/employees/anna/whatsapp-session'
    });

    expect(response.status).toBe(202);
    expect(JSON.parse(response.body)).toEqual({
      employeeId: 'anna',
      hasRuntimeSession: true,
      whatsappActive: false,
      runtimeStatus: 'starting',
      whatsappState: null,
      qrCode: null,
      lastError: null,
      lastDisconnectReason: null,
      lastEventAt: null,
      lastReadyAt: null,
      lastCheckedAt: '2026-03-29T20:00:00.000Z'
    });
    expect(sessionManager?.startSession).toHaveBeenCalledWith('anna');
  });

  it('should expose the full WhatsApp session payload through the protected app', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: true
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        lastCheckedAt: '2026-03-29T20:00:00.000Z',
        lastEventAt: '2026-03-29T19:59:00.000Z',
        runtimeStatus: 'waiting_for_qr',
        qrCode: 'raw-whatsapp-qr-string'
      })
    );

    const response = await performProtectedRequest(app as Express, {
      method: 'GET',
      path: '/employees/anna/whatsapp-session'
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      employeeId: 'anna',
      hasRuntimeSession: true,
      whatsappActive: false,
      runtimeStatus: 'waiting_for_qr',
      whatsappState: null,
      qrCode: 'raw-whatsapp-qr-string',
      lastError: null,
      lastDisconnectReason: null,
      lastEventAt: '2026-03-29T19:59:00.000Z',
      lastReadyAt: null,
      lastCheckedAt: '2026-03-29T20:00:00.000Z'
    });
    expect(sessionManager?.getSessionHealth).toHaveBeenCalledWith('anna');
  });

  it('should return 404 for WhatsApp session state when the employee does not exist', async () => {
    const response = await performProtectedRequest(app as Express, {
      method: 'GET',
      path: '/employees/missing/whatsapp-session'
    });

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Employee not found: missing'
    });
    expect(sessionManager?.getSessionHealth).not.toHaveBeenCalled();
  });

  it('should return a consistent json error for malformed request bodies', async () => {
    const response = await performProtectedRequest(app as Express, {
      body: '{"code":',
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST',
      path: '/employees'
    });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/json');
    expect(JSON.parse(response.body)).toEqual({
      error: 'Malformed JSON body'
    });
    expect(logger?.warn).toHaveBeenCalledWith('Malformed JSON request body');
  });

  it('should create employees through the mounted app routes with generated code', async () => {
    const response = await performProtectedRequest(app as Express, {
      body: JSON.stringify({
        displayName: 'Anna'
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST',
      path: '/employees'
    });

    expect(response.status).toBe(201);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna',
        isActive: false,
        phoneNumber: null,
        sessionDir: null
      })
    );
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
  });

  it('should deactivate employees through the mounted app routes', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: true
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );

    const response = await performProtectedRequest(app as Express, {
      body: JSON.stringify({
        isActive: false
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'PATCH',
      path: '/employees/anna'
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: false
      })
    );
    expect(sessionManager?.stopSession).toHaveBeenCalledWith('anna');
  });

  it('should return 500 and rollback deactivation when stopSession fails', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: true
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );
    (sessionManager?.stopSession as jest.Mock).mockRejectedValueOnce(
      new Error('destroy failed')
    );

    const response = await performProtectedRequest(app as Express, {
      body: JSON.stringify({
        isActive: false
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'PATCH',
      path: '/employees/anna'
    });

    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Failed to update WhatsApp session state'
    });
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
  });

  it('should enable employees through the mounted app routes without starting the runtime session', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: false
    });

    const response = await performProtectedRequest(app as Express, {
      body: JSON.stringify({
        isActive: true
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'PATCH',
      path: '/employees/anna'
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      code: 'anna',
      createdAt: expect.any(String),
      displayName: null,
      id: expect.any(Number),
      isActive: true,
      phoneNumber: null,
      sessionDir: null,
      updatedAt: expect.any(String)
    });
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
  });

  it('should delete employees with existing chats through the mounted app routes', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: true,
      phoneNumber: '380991112233'
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      isPhoneNumberVerified: true,
      phoneNumber: '380991112233'
    });
    database?.chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });

    const response = await performProtectedRequest(app as Express, {
      method: 'DELETE',
      path: '/employees/anna'
    });

    expect(response.status).toBe(204);
    expect(response.body).toBe('');
    expect(sessionManager?.stopSession).toHaveBeenCalledWith('anna');
    expect(database?.employees.findByCode('anna')).toBeUndefined();
    expect(database?.chats.countByEmployeeCode('anna')).toBe(0);
  });

  it('should return 404 when deleting an unknown employee', async () => {
    const response = await performProtectedRequest(app as Express, {
      method: 'DELETE',
      path: '/employees/missing'
    });

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Employee not found: missing'
    });
  });

  it('should return 500 and keep the employee when delete stopSession fails', async () => {
    database?.employees.create({
      code: 'anna',
      isActive: true
    });
    (sessionManager?.getSessionHealth as jest.Mock).mockResolvedValueOnce(
      buildSessionHealth({
        employeeId: 'anna',
        hasRuntimeSession: true,
        isSessionActive: true,
        runtimeStatus: 'ready'
      })
    );
    (sessionManager?.stopSession as jest.Mock).mockRejectedValueOnce(
      new Error('destroy failed')
    );

    const response = await performProtectedRequest(app as Express, {
      method: 'DELETE',
      path: '/employees/anna'
    });

    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Failed to delete employee'
    });
    expect(database?.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
  });
});

describe('app with real session manager integration', () => {
  let app: Express | undefined;
  let database: Database | undefined;
  let logger: Logger | undefined;
  let clientFactory: WhatsappClientFactory | undefined;
  let removeSessionDirectorySpy: jest.SpiedFunction<typeof fs.rm> | undefined;
  let realSessionManager: SessionManager | undefined;

  beforeEach(() => {
    removeSessionDirectorySpy = jest.spyOn(fs, 'rm').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    removeSessionDirectorySpy?.mockRestore();
    removeSessionDirectorySpy = undefined;
    await realSessionManager?.shutdown();
    database?.close();
    app = undefined;
    clientFactory = undefined;
    database = undefined;
    logger = undefined;
    realSessionManager = undefined;
  });

  it('should create employees without starting the real session manager', async () => {
    logger = createLogger();
    database = createDatabase({
      databasePath: ':memory:',
      logger
    });

    clientFactory = {
      create: jest.fn(() => createWhatsappClient())
    };

    realSessionManager = createRealSessionManager({
      clientFactory,
      employees: database.employees,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    app = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database.chats,
      employees: database.employees,
      logger,
      messages: database.messages,
      sessionManager: realSessionManager
    });

    const response = await performProtectedRequest(app, {
      body: JSON.stringify({
        displayName: 'Anna'
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST',
      path: '/employees'
    });

    expect(response.status).toBe(201);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna',
        isActive: false,
        phoneNumber: null,
        sessionDir: null
      })
    );
    expect(database.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: false
      })
    );
    expect(clientFactory.create).not.toHaveBeenCalled();
  });

  it('should rollback deactivate when the real session manager cannot stop the client', async () => {
    logger = createLogger();
    database = createDatabase({
      databasePath: ':memory:',
      logger
    });
    const client = createWhatsappClient();

    clientFactory = {
      create: jest.fn(() => client)
    };

    realSessionManager = createRealSessionManager({
      clientFactory,
      employees: database.employees,
      logger,
      qr: {
        generate: jest.fn()
      }
    });

    app = createApp({
      authPassword: AUTH_PASSWORD,
      chats: database.chats,
      employees: database.employees,
      logger,
      messages: database.messages,
      sessionManager: realSessionManager
    });

    database.employees.create({
      code: 'anna',
      displayName: 'Anna',
      phoneNumber: '380991112233',
      isActive: true
    });
    await realSessionManager.startSession('anna');

    (client.destroy as jest.Mock).mockRejectedValueOnce(new Error('destroy failed'));

    const patchResponse = await performProtectedRequest(app, {
      body: JSON.stringify({
        isActive: false
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'PATCH',
      path: '/employees/anna'
    });

    expect(patchResponse.status).toBe(500);
    expect(JSON.parse(patchResponse.body)).toEqual({
      error: 'Failed to update WhatsApp session state'
    });
    expect(database.employees.findByCode('anna')).toEqual(
      expect.objectContaining({
        code: 'anna',
        isActive: true
      })
    );
    expect(clientFactory.create).toHaveBeenCalledTimes(1);
  });
});

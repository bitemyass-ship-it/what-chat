import { createDatabase } from '../../src/database/database';
import { createWhatsappSessionController } from '../../src/controllers/whatsapp-session-controller';
import type { Database } from '../../src/database/types';
import type { Logger, SessionHealth, SessionManager } from '../../src/types/whatsapp';

describe('whatsapp session controller', () => {
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

  const createLogger = (): Logger => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  });

  const createResponse = () => {
    const response = {
      json: jest.fn(),
      send: jest.fn(),
      status: jest.fn()
    };

    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);
    response.send.mockReturnValue(response);

    return response;
  };

  let database: Database | undefined;
  let logger: Logger | undefined;
  let sessionManager: SessionManager | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
    logger = undefined;
    sessionManager = undefined;
  });

  const createController = () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });
    logger = createLogger();
    sessionManager = {
      getSessionHealth: jest.fn().mockResolvedValue(buildSessionHealth()),
      shutdown: jest.fn(),
      startAll: jest.fn(),
      startSession: jest.fn().mockResolvedValue(undefined),
      stopSession: jest.fn()
    };

    return createWhatsappSessionController({
      employees: database.employees,
      logger,
      sessionManager
    });
  };

  it('should start a WhatsApp runtime session', async () => {
    const controller = createController();
    const response = createResponse();

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

    await controller.create(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(202);
    expect(response.json).toHaveBeenCalledWith({
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

  it('should keep repeated WhatsApp session activation idempotent', async () => {
    const controller = createController();
    const response = createResponse();

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

    await controller.create(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
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
    const controller = createController();
    const response = createResponse();

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

    await controller.create(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(202);
    expect(response.json).toHaveBeenCalledWith({
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

  it('should reject WhatsApp session activation without a saved phone number', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({
      code: 'anna',
      isActive: true,
      phoneNumber: null
    });

    await controller.create(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Employee phone number is required to start a WhatsApp session'
    });
    expect(sessionManager?.startSession).not.toHaveBeenCalled();
  });

  it('should return the full WhatsApp session payload', async () => {
    const controller = createController();
    const response = createResponse();

    database?.employees.create({ code: 'anna', isActive: true });
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

    await controller.get(
      {
        params: {
          code: 'anna'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
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
  });

  it('should return 404 for an unknown employee', async () => {
    const controller = createController();
    const response = createResponse();

    await controller.get(
      {
        params: {
          code: 'missing'
        }
      } as never,
      response as never,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Employee not found: missing'
    });
    expect(sessionManager?.getSessionHealth).not.toHaveBeenCalled();
  });
});

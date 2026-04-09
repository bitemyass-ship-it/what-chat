import type { RequestHandler } from 'express';
import type { EmployeesRepository } from '../database/types';
import type { Logger, SessionHealth, SessionManager } from '../types/whatsapp';

interface CreateWhatsappSessionControllerOptions {
  employees: EmployeesRepository;
  logger: Logger;
  sessionManager: SessionManager;
}

interface WhatsappSessionController {
  create: RequestHandler;
  get: RequestHandler;
}

const normalizeCode = (value: string): string => value.trim();

const getCodeParam = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('code route parameter is required');
  }

  const normalizedCode = normalizeCode(value);

  if (normalizedCode === '') {
    throw new Error('code route parameter is required');
  }

  return normalizedCode;
};

const createUnexpectedErrorResponse = (
  logger: Logger,
  response: Parameters<RequestHandler>[1],
  options: {
    error: unknown;
    logMessage: string;
    publicMessage: string;
    meta?: Record<string, unknown>;
  }
): void => {
  logger.error(options.logMessage, {
    ...(options.meta ?? {}),
    error: options.error instanceof Error ? options.error.message : 'Unknown error'
  });
  response.status(500).json({
    error: options.publicMessage
  });
};

const serializeWhatsappSession = (health: SessionHealth) => ({
  employeeId: health.employeeId,
  hasRuntimeSession: health.hasRuntimeSession,
  whatsappActive: health.isSessionActive,
  runtimeStatus: health.runtimeStatus,
  whatsappState: health.whatsappState,
  qrCode: health.runtimeStatus === 'waiting_for_qr' ? health.qrCode : null,
  lastError: health.lastError,
  lastDisconnectReason: health.lastDisconnectReason,
  lastEventAt: health.lastEventAt,
  lastReadyAt: health.lastReadyAt,
  lastCheckedAt: health.lastCheckedAt
});

export const createWhatsappSessionController = ({
  employees,
  logger,
  sessionManager
}: CreateWhatsappSessionControllerOptions): WhatsappSessionController => ({
  create: async (request, response) => {
    let code: string;

    try {
      code = getCodeParam(request.params.code);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid employee code'
      });
      return;
    }

    try {
      const employee = employees.findByCode(code);

      if (!employee) {
        response.status(404).json({
          error: `Employee not found: ${code}`
        });
        return;
      }

      if (!employee.phoneNumber || employee.phoneNumber.trim() === '') {
        response.status(409).json({
          error: 'Employee phone number is required to start a WhatsApp session'
        });
        return;
      }

      if (!employee.isActive) {
        employees.upsert({
          code,
          isActive: true
        });
      }

      const currentHealth = await sessionManager.getSessionHealth(code);

      if (currentHealth.hasRuntimeSession) {
        response.status(200).json(serializeWhatsappSession(currentHealth));
        return;
      }

      void sessionManager.startSession(code).catch((error) => {
        logger.error('WhatsApp session activation failed asynchronously', {
          code,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
      const nextHealth = await sessionManager.getSessionHealth(code);

      response.status(202).json(serializeWhatsappSession(nextHealth));
    } catch (error) {
      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'WhatsApp session activation failed',
        publicMessage: 'Failed to activate WhatsApp session',
        meta: {
          code
        }
      });
    }
  },

  get: async (request, response) => {
    let code: string;

    try {
      code = getCodeParam(request.params.code);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid employee code'
      });
      return;
    }

    try {
      const employee = employees.findByCode(code);

      if (!employee) {
        response.status(404).json({
          error: `Employee not found: ${code}`
        });
        return;
      }

      const health = await sessionManager.getSessionHealth(code);

      response.status(200).json(serializeWhatsappSession(health));
    } catch (error) {
      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'WhatsApp session state lookup failed',
        publicMessage: 'Failed to read WhatsApp session state',
        meta: {
          code
        }
      });
    }
  }
});

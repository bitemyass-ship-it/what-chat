import fs from 'node:fs/promises';
import type { RequestHandler } from 'express';
import type {
  ChatsRepository,
  ChatAnalyticsRecord,
  EmployeeRecord,
  EmployeesRepository,
  MessageRecord,
  MessagesRepository,
  UpsertEmployeeInput
} from '../database/types';
import type { Logger, SessionManager } from '../types/whatsapp';
import { normalizePhoneDigits } from '../utils/chat-identity';
import {
  buildEmployeeCodeBase,
  buildEmployeeCodeCandidate,
  EMPLOYEE_CODE_ALLOCATION_MAX_ATTEMPTS
} from '../utils/employee-code';
import { resolveEmployeeSessionLocation } from '../whatsapp/session-location';

interface CreateEmployeesControllerOptions {
  chats: ChatsRepository;
  employees: EmployeesRepository;
  logger: Logger;
  messages: MessagesRepository;
  sessionManager: SessionManager;
}

interface EmployeesController {
  create: RequestHandler;
  getByCode: RequestHandler;
  getChats: RequestHandler;
  getChatMessages: RequestHandler;
  getHealth: RequestHandler;
  list: RequestHandler;
  remove: RequestHandler;
  update: RequestHandler;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeCode = (value: string): string => value.trim();

const normalizeOptionalString = (
  value: unknown,
  fieldName: string
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string or null`);
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
};

const normalizeOptionalBoolean = (
  value: unknown,
  fieldName: string
): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
};

const serializeEmployee = (employee: EmployeeRecord) => ({
  id: employee.id,
  code: employee.code,
  displayName: employee.displayName,
  phoneNumber: employee.phoneNumber,
  isActive: employee.isActive,
  sessionDir: employee.sessionDir,
  createdAt: employee.createdAt,
  updatedAt: employee.updatedAt
});

interface CreateEmployeeByNameInput {
  displayName: string;
}

const CREATE_EMPLOYEE_FORBIDDEN_FIELDS = [
  'code',
  'phoneNumber',
  'isActive',
  'sessionDir'
] as const;

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const parseCreateEmployeeInput = (value: unknown): CreateEmployeeByNameInput => {
  if (!isRecord(value)) {
    throw new Error('Request body must be an object');
  }

  for (const fieldName of CREATE_EMPLOYEE_FORBIDDEN_FIELDS) {
    if (hasOwn(value, fieldName)) {
      throw new Error(`${fieldName} is not allowed`);
    }
  }

  if (!hasOwn(value, 'displayName')) {
    throw new Error('displayName is required');
  }

  if (typeof value.displayName !== 'string') {
    throw new Error('displayName must be a string');
  }

  const displayName = value.displayName.trim();

  if (displayName === '') {
    throw new Error('displayName cannot be empty');
  }

  return { displayName };
};

const parseUpdateEmployeeInput = (
  code: string,
  value: unknown
): UpsertEmployeeInput => {
  if (!isRecord(value)) {
    throw new Error('Request body must be an object');
  }

  if (value.code !== undefined) {
    if (typeof value.code !== 'string' || normalizeCode(value.code) !== code) {
      throw new Error('code in body must match route parameter');
    }
  }

  return {
    code,
    displayName: normalizeOptionalString(value.displayName, 'displayName'),
    phoneNumber: normalizeOptionalString(value.phoneNumber, 'phoneNumber'),
    isActive: normalizeOptionalBoolean(value.isActive, 'isActive'),
    sessionDir: normalizeOptionalString(value.sessionDir, 'sessionDir')
  };
};

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

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && /unique/i.test(error.message);

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

const toUpsertEmployeeInput = (employee: EmployeeRecord): UpsertEmployeeInput => ({
  code: employee.code,
  displayName: employee.displayName,
  phoneNumber: employee.phoneNumber,
  isActive: employee.isActive,
  sessionDir: employee.sessionDir
});

const deleteEmployeeSessionStorage = async (
  employee: EmployeeRecord,
  logger: Logger
): Promise<void> => {
  const { sessionStoragePath } = resolveEmployeeSessionLocation(employee);

  if (!sessionStoragePath) {
    return;
  }

  await fs.rm(sessionStoragePath, {
    force: true,
    recursive: true
  });
  logger.info('Deleted WhatsApp session storage', {
    code: employee.code,
    sessionStoragePath
  });
};

const didEmployeePhoneNumberChange = (
  previousEmployee: EmployeeRecord,
  nextEmployee: EmployeeRecord
): boolean =>
  normalizePhoneDigits(previousEmployee.phoneNumber) !==
  normalizePhoneDigits(nextEmployee.phoneNumber);

const formatChatTimestampAsIsoUtc = (value: number | null): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const normalizedTimestamp =
    Math.abs(value) >= 10_000_000_000
      ? Math.trunc(value)
      : Math.trunc(value * 1_000);
  const parsedDate = new Date(normalizedTimestamp);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString();
};

const serializeEmployeeChat = (chat: ChatAnalyticsRecord) => ({
  chatRecordId: chat.id,
  displayName: chat.displayName,
  phoneNumber: chat.phoneNumber,
  rawChatLabel: chat.chatId,
  firstMessageAt: formatChatTimestampAsIsoUtc(chat.firstMessageTimestamp),
  lastMessageAt: formatChatTimestampAsIsoUtc(chat.lastMessageTimestamp),
  lastMessagePreview: chat.lastMessagePreview,
  totalMessages: chat.totalMessages,
  incomingMessages: chat.incomingMessages,
  outgoingMessages: chat.outgoingMessages
});

const serializeEmployeeChatMessage = (message: MessageRecord) => ({
  messageId: message.id,
  externalMessageId: message.externalMessageId,
  timestamp: formatChatTimestampAsIsoUtc(message.timestamp),
  direction: message.direction,
  body: message.body,
  messageType: message.messageType
});

const getChatRecordIdParam = (value: unknown): number => {
  if (typeof value !== 'string') {
    throw new Error('chatRecordId route parameter is required');
  }

  const normalizedValue = value.trim();

  if (!/^\d+$/u.test(normalizedValue)) {
    throw new Error('chatRecordId route parameter must be a positive integer');
  }

  const chatRecordId = Number(normalizedValue);

  if (!Number.isSafeInteger(chatRecordId) || chatRecordId <= 0) {
    throw new Error('chatRecordId route parameter must be a positive integer');
  }

  return chatRecordId;
};

const EMPLOYEE_CHATS_PAGE_SIZE = 20;

const parsePositiveIntegerQueryParam = (
  value: unknown,
  parameterName: string
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${parameterName} query parameter must be a positive integer`);
  }

  const normalizedValue = value.trim();

  if (!/^\d+$/u.test(normalizedValue)) {
    throw new Error(`${parameterName} query parameter must be a positive integer`);
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${parameterName} query parameter must be a positive integer`);
  }

  return parsedValue;
};

const parseEmployeeChatsPage = (value: unknown): number =>
  parsePositiveIntegerQueryParam(value, 'page') ?? 1;

const parseEmployeeChatsPageSize = (value: unknown): number => {
  if (value === undefined) {
    return EMPLOYEE_CHATS_PAGE_SIZE;
  }

  const pageSize = parsePositiveIntegerQueryParam(value, 'pageSize');

  if (pageSize !== EMPLOYEE_CHATS_PAGE_SIZE) {
    throw new Error(`pageSize query parameter must be ${EMPLOYEE_CHATS_PAGE_SIZE}`);
  }

  return pageSize;
};

export const createEmployeesController = ({
  chats,
  employees,
  logger,
  messages,
  sessionManager
}: CreateEmployeesControllerOptions): EmployeesController => ({
  create: async (request, response) => {
    let input: CreateEmployeeByNameInput;

    try {
      input = parseCreateEmployeeInput(request.body);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid employee payload'
      });
      return;
    }

    try {
      const baseCode = buildEmployeeCodeBase(input.displayName);
      let employee: EmployeeRecord | undefined;

      for (
        let attemptNumber = 1;
        attemptNumber <= EMPLOYEE_CODE_ALLOCATION_MAX_ATTEMPTS;
        attemptNumber += 1
      ) {
        const candidateCode = buildEmployeeCodeCandidate(baseCode, attemptNumber);

        if (employees.findByCode(candidateCode)) {
          logger.warn('Employee code candidate unavailable', {
            attemptNumber,
            baseCode,
            code: candidateCode,
            reason: 'already_exists'
          });
          continue;
        }

        try {
          employee = employees.create({
            code: candidateCode,
            displayName: input.displayName,
            phoneNumber: null,
            isActive: false,
            sessionDir: null
          });
          break;
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            logger.warn('Employee code candidate unavailable', {
              attemptNumber,
              baseCode,
              code: candidateCode,
              reason: 'unique_conflict'
            });
            continue;
          }

          throw error;
        }
      }

      if (!employee) {
        logger.error('Employee code allocation failed', {
          attempts: EMPLOYEE_CODE_ALLOCATION_MAX_ATTEMPTS,
          baseCode
        });
        response.status(409).json({
          error: 'Unable to allocate unique employee code'
        });
        return;
      }

      logger.info('Employee created', { code: employee.code });
      response.status(201).json(serializeEmployee(employee));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        logger.error('Employee code allocation failed', {
          attempts: EMPLOYEE_CODE_ALLOCATION_MAX_ATTEMPTS,
          baseCode: buildEmployeeCodeBase(input.displayName),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        response.status(409).json({
          error: 'Unable to allocate unique employee code'
        });
        return;
      }

      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'Employee creation failed',
        publicMessage: 'Failed to create employee',
        meta: {
          displayName: input.displayName
        }
      });
    }
  },

  getByCode: (request, response) => {
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

      response.status(200).json(serializeEmployee(employee));
    } catch (error) {
      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'Employee lookup failed',
        publicMessage: 'Failed to read employee',
        meta: {
          code
        }
      });
    }
  },

  getChats: (request, response) => {
    let code: string;
    let page: number;
    let pageSize: number;

    try {
      code = getCodeParam(request.params.code);
      page = parseEmployeeChatsPage(request.query?.page);
      pageSize = parseEmployeeChatsPageSize(request.query?.pageSize);
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : 'Invalid employee chats query parameters'
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

      const total = chats.countByEmployeeCode(code);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;
      const items = chats
        .listAnalyticsByEmployeeCode(code, {
          limit: pageSize,
          offset
        })
        .map(serializeEmployeeChat);

      response.status(200).json({
        items,
        page,
        pageSize,
        total,
        totalPages
      });
    } catch (error) {
      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'Employee chats lookup failed',
        publicMessage: 'Failed to read employee chats',
        meta: {
          code
        }
      });
    }
  },

  getChatMessages: (request, response) => {
    let code: string;
    let chatRecordId: number;
    let page: number;
    let pageSize: number;

    try {
      code = getCodeParam(request.params.code);
      chatRecordId = getChatRecordIdParam(request.params.chatRecordId);
      page = parseEmployeeChatsPage(request.query?.page);
      pageSize = parseEmployeeChatsPageSize(request.query?.pageSize);
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : 'Invalid employee chat messages parameters'
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

      const chat = chats.findByEmployeeCodeAndRecordId(code, chatRecordId);

      if (!chat) {
        response.status(404).json({
          error: `Chat not found: ${chatRecordId}`
        });
        return;
      }

      const total = messages.countByEmployeeCodeAndChatRecordId(code, chatRecordId);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;
      const items = messages
        .listByEmployeeCodeAndChatRecordId(code, chatRecordId, {
          limit: pageSize,
          offset
        })
        .map(serializeEmployeeChatMessage);

      response.status(200).json({
        items,
        page,
        pageSize,
        total,
        totalPages
      });
    } catch (error) {
      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'Employee chat messages lookup failed',
        publicMessage: 'Failed to read employee chat messages',
        meta: {
          code,
          chatRecordId
        }
      });
    }
  },

  getHealth: async (request, response) => {
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

      response.status(200).json({
        whatsappActive: health.isSessionActive
      });
    } catch (error) {
      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'Employee health lookup failed',
        publicMessage: 'Failed to read employee health',
        meta: {
          code
        }
      });
    }
  },

  list: (_request, response) => {
    try {
      response.status(200).json(employees.listAll().map(serializeEmployee));
    } catch (error) {
      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'Employees listing failed',
        publicMessage: 'Failed to list employees'
      });
    }
  },

  remove: async (request, response) => {
    let code: string;

    try {
      code = getCodeParam(request.params.code);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid employee code'
      });
      return;
    }

    let existingEmployee: EmployeeRecord | undefined;
    let hadRuntimeSession = false;
    let sessionStopped = false;
    let employeeDeleted = false;

    try {
      existingEmployee = employees.findByCode(code);

      if (!existingEmployee) {
        response.status(404).json({
          error: `Employee not found: ${code}`
        });
        return;
      }

      const currentHealth = await sessionManager.getSessionHealth(code);
      hadRuntimeSession = currentHealth.hasRuntimeSession;

      if (hadRuntimeSession) {
        await sessionManager.stopSession(code);
        sessionStopped = true;
      }

      await deleteEmployeeSessionStorage(existingEmployee, logger);

      employeeDeleted = employees.deleteByCode(code);

      if (!employeeDeleted) {
        throw new Error(`Employee delete returned no changes: ${code}`);
      }

      logger.info('Employee deleted', { code });
      response.status(204).send();
    } catch (error) {
      if (sessionStopped && hadRuntimeSession && !employeeDeleted) {
        try {
          await sessionManager.startSession(code);
        } catch (rollbackError) {
          logger.error('Employee delete rollback failed', {
            code,
            error: rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error'
          });
        }
      }

      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'Employee deletion failed',
        publicMessage: 'Failed to delete employee',
        meta: {
          code
        }
      });
    }
  },

  update: async (request, response) => {
    let code: string;
    let input: UpsertEmployeeInput;

    try {
      code = getCodeParam(request.params.code);
      input = parseUpdateEmployeeInput(code, request.body);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid employee payload'
      });
      return;
    }

    let existingEmployee: EmployeeRecord | undefined;
    let sessionStopped = false;

    try {
      existingEmployee = employees.findByCode(code);

      if (!existingEmployee) {
        response.status(404).json({
          error: `Employee not found: ${code}`
        });
        return;
      }

      const currentHealth = await sessionManager.getSessionHealth(code);
      let employee = employees.upsert(input);
      const didPhoneNumberChange = didEmployeePhoneNumberChange(
        existingEmployee,
        employee
      );

      if (didPhoneNumberChange && employee.isActive) {
        employee = employees.upsert({
          code: employee.code,
          isActive: false
        });
      }

      const shouldDeleteSessionStorage = input.isActive === false;
      const shouldStopSession =
        currentHealth.hasRuntimeSession &&
        (!employee.isActive || didPhoneNumberChange);
      const shouldResetSessionForPhoneChange =
        currentHealth.hasRuntimeSession && didPhoneNumberChange;

      try {
        if (shouldStopSession || shouldResetSessionForPhoneChange) {
          await sessionManager.stopSession(employee.code);
          sessionStopped = true;
        }

        if (shouldDeleteSessionStorage) {
          await deleteEmployeeSessionStorage(existingEmployee, logger);
        }
      } catch (error) {
        try {
          employees.upsert(toUpsertEmployeeInput(existingEmployee));
        } catch (rollbackError) {
          logger.error('Employee update rollback failed', {
            code,
            error: rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error'
          });
        }

        if (sessionStopped && existingEmployee.isActive) {
          try {
            await sessionManager.startSession(code);
          } catch (rollbackError) {
            logger.error('Employee update session rollback failed', {
              code,
              error: rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error'
            });
          }
        }

        createUnexpectedErrorResponse(logger, response, {
          error,
          logMessage: 'Employee session synchronization failed after update',
          publicMessage: 'Failed to update WhatsApp session state',
          meta: {
            code
          }
        });
        return;
      }

      logger.info('Employee updated', { code: employee.code });
      response.status(200).json(serializeEmployee(employee));
    } catch (error) {
      createUnexpectedErrorResponse(logger, response, {
        error,
        logMessage: 'Employee update failed',
        publicMessage: 'Failed to update employee',
        meta: {
          code
        }
      });
    }
  }
});

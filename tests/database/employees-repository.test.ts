import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createChatsRepository } from '../../src/database/chats-repository';
import { createDatabase, resolveDatabasePath } from '../../src/database/database';
import { createEmployeesRepository } from '../../src/database/employees-repository';
import { CHATS_SCHEMA_SQL, EMPLOYEES_SCHEMA_SQL } from '../../src/database/schema';
import type { Database } from '../../src/database/types';
import type { Logger } from '../../src/types/whatsapp';

describe('employees repository', () => {
  const createLogger = (): Logger => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  });

  let database: Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('should resolve a relative SQLite path from the project root', () => {
    const resolvedPath = resolveDatabasePath({
      databasePath: 'data/test.sqlite',
      projectRoot: '/tmp/project-root'
    });

    expect(resolvedPath).toBe(path.resolve('/tmp/project-root', 'data/test.sqlite'));
  });

  it('should require an explicit absolute SQLite path in production', () => {
    expect(() =>
      resolveDatabasePath({
        env: {
          NODE_ENV: 'production'
        },
        projectRoot: '/tmp/project-root'
      })
    ).toThrow('WHATSAPP_DATABASE_PATH is required for first-mode production');

    expect(() =>
      resolveDatabasePath({
        env: {
          NODE_ENV: 'production',
          WHATSAPP_DATABASE_PATH: 'data/test.sqlite'
        },
        projectRoot: '/tmp/project-root'
      })
    ).toThrow(
      'WHATSAPP_DATABASE_PATH must be an absolute path for first-mode production'
    );
  });

  it('should reject SQLite paths inside the repository checkout in production', () => {
    expect(() =>
      resolveDatabasePath({
        env: {
          NODE_ENV: 'production',
          WHATSAPP_DATABASE_PATH: '/tmp/project-root/data/test.sqlite'
        },
        projectRoot: '/tmp/project-root'
      })
    ).toThrow(
      'WHATSAPP_DATABASE_PATH must point outside the repository checkout for first-mode production'
    );
  });

  it('should accept an absolute persistent SQLite path outside the repository in production', () => {
    expect(
      resolveDatabasePath({
        env: {
          NODE_ENV: 'production',
          WHATSAPP_DATABASE_PATH: '/var/lib/whatsapp-monitor/data/app.sqlite'
        },
        projectRoot: '/tmp/project-root'
      })
    ).toBe('/var/lib/whatsapp-monitor/data/app.sqlite');
  });

  it('should create and return employees sorted by code', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });

    database.employees.create({ code: 'bob' });
    database.employees.create({ code: 'anna', displayName: 'Anna' });

    expect(database.employees.listActive()).toEqual([
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna',
        isActive: true
      }),
      expect.objectContaining({
        code: 'bob',
        displayName: null,
        isActive: true
      })
    ]);
  });

  it('should upsert employees without erasing stored fields that were not provided', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });

    database.employees.create({
      code: 'anna',
      displayName: 'Anna',
      phoneNumber: '380991112233',
      sessionDir: 'sessions/session-anna'
    });

    const employee = database.employees.upsert({
      code: 'anna',
      isActive: false
    });

    expect(employee).toEqual(
      expect.objectContaining({
        code: 'anna',
        displayName: 'Anna',
        phoneNumber: '380991112233',
        sessionDir: 'sessions/session-anna',
        isActive: false
      })
    );
  });

  it('should create the database file and parent directory for file-backed storage', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-monitor-db-'));
    const databasePath = path.join(tempDirectory, 'nested', 'app.sqlite');

    database = createDatabase({
      databasePath,
      logger: createLogger()
    });

    expect(fs.existsSync(path.dirname(databasePath))).toBe(true);
    expect(fs.existsSync(databasePath)).toBe(true);
  });

  it('should delete an employee by code', () => {
    database = createDatabase({
      databasePath: ':memory:',
      logger: createLogger()
    });

    database.employees.create({ code: 'anna' });

    expect(database.employees.deleteByCode('anna')).toBe(true);
    expect(database.employees.findByCode('anna')).toBeUndefined();
    expect(database.employees.deleteByCode('anna')).toBe(false);
  });

  it('should cascade delete chats and chat aliases when removing an employee', () => {
    const connection = new DatabaseSync(':memory:');

    connection.exec('PRAGMA foreign_keys = ON;');
    connection.exec(EMPLOYEES_SCHEMA_SQL);
    connection.exec(CHATS_SCHEMA_SQL);

    const employees = createEmployeesRepository(connection);
    const chats = createChatsRepository(connection);
    employees.create({
      code: 'anna',
      phoneNumber: '380991112233'
    });
    chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '999999@lid',
      isPhoneNumberVerified: true,
      phoneNumber: '380991112233'
    });
    chats.upsertByEmployeeCode({
      employeeCode: 'anna',
      chatId: '380991112233@c.us'
    });

    expect(
      (
        connection.prepare('SELECT COUNT(*) AS total FROM chats').get() as {
          total: number;
        }
      ).total
    ).toBe(1);
    expect(
      (
        connection.prepare('SELECT COUNT(*) AS total FROM chat_aliases').get() as {
          total: number;
        }
      ).total
    ).toBe(2);

    expect(employees.deleteByCode('anna')).toBe(true);
    expect(
      (
        connection.prepare('SELECT COUNT(*) AS total FROM chats').get() as {
          total: number;
        }
      ).total
    ).toBe(0);
    expect(
      (
        connection.prepare('SELECT COUNT(*) AS total FROM chat_aliases').get() as {
          total: number;
        }
      ).total
    ).toBe(0);

    connection.close();
  });
});

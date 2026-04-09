import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../types/whatsapp';
import { inferLegacyPhoneNumberVerification } from '../utils/chat-identity';
import { requirePersistentProductionPath } from '../utils/env';
import { findProjectRoot } from '../utils/project-root';
import { createChatsRepository } from './chats-repository';
import { createEmployeesRepository } from './employees-repository';
import { createMessagesRepository } from './messages-repository';
import {
  CHATS_SCHEMA_SQL,
  EMPLOYEES_SCHEMA_SQL,
  MESSAGES_SCHEMA_SQL
} from './schema';
import type { Database } from './types';

const DEFAULT_DATABASE_PATH = 'data/whatsapp-monitor.sqlite';

interface ResolveDatabasePathOptions {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  databasePath?: string;
}

interface CreateDatabaseOptions extends ResolveDatabasePathOptions {
  logger: Logger;
}

export const resolveDatabasePath = ({
  env = process.env,
  projectRoot = findProjectRoot(__dirname),
  databasePath
}: ResolveDatabasePathOptions = {}): string => {
  const configuredPath = databasePath ?? env.WHATSAPP_DATABASE_PATH;

  if (env.NODE_ENV === 'production') {
    return requirePersistentProductionPath({
      env,
      pathValue: configuredPath,
      projectRoot,
      variableName: 'WHATSAPP_DATABASE_PATH'
    });
  }

  const fallbackPath = configuredPath ?? DEFAULT_DATABASE_PATH;

  if (fallbackPath === ':memory:' || path.isAbsolute(fallbackPath)) {
    return fallbackPath;
  }

  return path.resolve(projectRoot, fallbackPath);
};

export const createDatabase = ({
  env,
  logger,
  projectRoot,
  databasePath
}: CreateDatabaseOptions): Database => {
  const resolvedDatabasePath = resolveDatabasePath({
    env,
    projectRoot,
    databasePath
  });

  if (resolvedDatabasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });
  }

  const connection = new DatabaseSync(resolvedDatabasePath);
  let isClosed = false;

  const resumeLegacyChatsMigration = (): void => {
    const legacyRows = connection
      .prepare(`
        SELECT
          e.code AS employee_code,
          c.chat_id,
          c.phone_number,
          c.last_message_timestamp
        FROM chats_legacy c
        INNER JOIN employees e ON e.id = c.employee_id
        ORDER BY c.employee_id ASC, c.id ASC
      `)
      .all() as Array<{
      employee_code: string;
      chat_id: string;
      phone_number: string | null;
      last_message_timestamp: number | null;
    }>;
    const migratingChats = createChatsRepository(connection);

    for (const row of legacyRows) {
      migratingChats.upsertByEmployeeCode({
        employeeCode: row.employee_code,
        chatId: row.chat_id,
        isPhoneNumberVerified: inferLegacyPhoneNumberVerification({
          chatId: row.chat_id,
          phoneNumber: row.phone_number
        }),
        phoneNumber: row.phone_number,
        lastMessageTimestamp: row.last_message_timestamp
      });
    }

    connection.exec('DROP TABLE chats_legacy');
  };

  const migrateLegacyChatsTable = (): void => {
    logger.info('Migrating legacy chats table to canonical chat identity schema');

    connection.exec('ALTER TABLE chats RENAME TO chats_legacy');
    connection.exec(CHATS_SCHEMA_SQL);
    resumeLegacyChatsMigration();
  };

  const tableExists = (tableName: string): boolean =>
    Boolean(
      connection
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name = ?
          `
        )
        .get(tableName)
    );

  const listTableColumns = (tableName: string): string[] =>
    connection
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((row) => (row as { name: string }).name);

  const ensureChatAliasesBackfill = (): void => {
    connection.exec(`
      INSERT OR IGNORE INTO chat_aliases (
        chat_record_id,
        employee_id,
        alias_chat_id
      )
      SELECT
        id,
        employee_id,
        chat_id
      FROM chats
    `);
  };

  const ensureChatsAdditiveColumns = (): void => {
    const chatsColumns = new Set(listTableColumns('chats'));
    const additiveColumns = [
      "display_name TEXT",
      "chat_kind TEXT NOT NULL DEFAULT 'direct'",
      "is_archived INTEGER NOT NULL DEFAULT 0",
      "is_pinned INTEGER NOT NULL DEFAULT 0",
      "unread_count INTEGER NOT NULL DEFAULT 0",
      'last_message_id TEXT',
      'last_message_preview TEXT',
      'last_polled_at TEXT',
      'last_messages_synced_at TEXT'
    ];

    for (const columnDefinition of additiveColumns) {
      const columnName = columnDefinition.split(' ')[0];

      if (chatsColumns.has(columnName)) {
        continue;
      }

      connection.exec(`ALTER TABLE chats ADD COLUMN ${columnDefinition}`);
    }
  };

  const ensureMessagesAdditiveColumns = (): void => {
    if (!tableExists('messages')) {
      return;
    }

    const messageColumns = new Set(listTableColumns('messages'));
    const additiveColumns = ['call_status TEXT', 'call_media_type TEXT'];

    for (const columnDefinition of additiveColumns) {
      const columnName = columnDefinition.split(' ')[0];

      if (messageColumns.has(columnName)) {
        continue;
      }

      connection.exec(`ALTER TABLE messages ADD COLUMN ${columnDefinition}`);
    }
  };

  const ensureSchema = (): void => {
    connection.exec(EMPLOYEES_SCHEMA_SQL);

    if (tableExists('chats_legacy')) {
      logger.info('Resuming incomplete chats migration from legacy table');

      if (!tableExists('chats')) {
        connection.exec(CHATS_SCHEMA_SQL);
      } else {
        ensureChatsAdditiveColumns();
        connection.exec(CHATS_SCHEMA_SQL);
      }

      resumeLegacyChatsMigration();
      ensureChatAliasesBackfill();
    } else if (!tableExists('chats')) {
      connection.exec(CHATS_SCHEMA_SQL);
    } else {
      const chatsColumns = listTableColumns('chats');

      if (!chatsColumns.includes('contact_key')) {
        migrateLegacyChatsTable();
      } else {
        ensureChatsAdditiveColumns();
        connection.exec(CHATS_SCHEMA_SQL);
        ensureChatAliasesBackfill();
      }
    }

    if (!tableExists('messages')) {
      connection.exec(MESSAGES_SCHEMA_SQL);
    } else {
      ensureMessagesAdditiveColumns();
      connection.exec(MESSAGES_SCHEMA_SQL);
    }
  };

  connection.exec('PRAGMA foreign_keys = ON;');
  connection.exec('PRAGMA journal_mode = WAL;');
  ensureSchema();

  logger.info('SQLite database ready', {
    databasePath: resolvedDatabasePath
  });

  const chats = createChatsRepository(connection);
  const messages = createMessagesRepository(connection);

  return {
    close(): void {
      if (isClosed) {
        return;
      }

      connection.close();
      isClosed = true;

      logger.info('SQLite database closed', {
        databasePath: resolvedDatabasePath
      });
    },

    chats,
    employees: createEmployeesRepository(connection),
    messages
  };
};

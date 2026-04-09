import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../../src/database/database';
import { EMPLOYEES_SCHEMA_SQL } from '../../src/database/schema';
import type { Database } from '../../src/database/types';
import type { Logger } from '../../src/types/whatsapp';

describe('database additive migrations', () => {
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

  it('should migrate an existing chats table without dropping aliases and create messages', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-monitor-additive-'));
    const databasePath = path.join(tempDirectory, 'app.sqlite');
    const connection = new DatabaseSync(databasePath);

    connection.exec(EMPLOYEES_SCHEMA_SQL);
    connection.exec(`
      CREATE TABLE chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        contact_key TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        phone_number TEXT,
        last_message_timestamp INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, contact_key),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE chat_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_record_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        alias_chat_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, alias_chat_id),
        FOREIGN KEY (chat_record_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );
    `);
    connection.prepare(`INSERT INTO employees (code, is_active) VALUES ('anna', 1)`).run();
    connection
      .prepare(`
        INSERT INTO chats (
          employee_id,
          contact_key,
          chat_id,
          phone_number,
          last_message_timestamp
        )
        VALUES (1, 'phone:123', '123@c.us', '123', 100)
      `)
      .run();
    connection
      .prepare(`
        INSERT INTO chat_aliases (
          chat_record_id,
          employee_id,
          alias_chat_id
        )
        VALUES (1, 1, '123@c.us')
      `)
      .run();
    connection.close();

    database = createDatabase({
      databasePath,
      logger: createLogger()
    });

    const verificationConnection = new DatabaseSync(databasePath);
    const chatsColumns = verificationConnection
      .prepare(`PRAGMA table_info(chats)`)
      .all() as Array<{ name: string }>;

    expect(chatsColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'display_name',
        'chat_kind',
        'is_archived',
        'is_pinned',
        'unread_count',
        'last_message_id',
        'last_message_preview',
        'last_polled_at',
        'last_messages_synced_at'
      ])
    );
    expect(
      (verificationConnection.prepare(`SELECT COUNT(*) AS total FROM messages`).get() as {
        total: number;
      }).total
    ).toBe(0);
    expect(
      (verificationConnection.prepare(`SELECT COUNT(*) AS total FROM chat_aliases`).get() as {
        total: number;
      }).total
    ).toBe(1);
    expect(database.chats.findByEmployeeCodeAndChatId('anna', '123@c.us')).toEqual(
      expect.objectContaining({
        chatId: '123@c.us',
        phoneNumber: '123'
      })
    );

    verificationConnection.close();
  });

  it('should resume incomplete migration when chats_legacy and an older canonical chats table both exist', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-monitor-resume-'));
    const databasePath = path.join(tempDirectory, 'app.sqlite');
    const connection = new DatabaseSync(databasePath);

    connection.exec(EMPLOYEES_SCHEMA_SQL);
    connection.exec(`
      CREATE TABLE chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        contact_key TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        phone_number TEXT,
        last_message_timestamp INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, contact_key),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE chat_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_record_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        alias_chat_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, alias_chat_id),
        FOREIGN KEY (chat_record_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE chats_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        phone_number TEXT,
        last_message_timestamp INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    connection.prepare(`INSERT INTO employees (code, is_active) VALUES ('anna', 1)`).run();
    connection
      .prepare(`
        INSERT INTO chats_legacy (
          employee_id,
          chat_id,
          phone_number,
          last_message_timestamp
        )
        VALUES (1, '999999@lid', '380991112233', 200)
      `)
      .run();
    connection.close();

    expect(() => {
      database = createDatabase({
        databasePath,
        logger: createLogger()
      });
    }).not.toThrow();

    expect(database?.chats.findByEmployeeCodeAndChatId('anna', '999999@lid')).toEqual(
      expect.objectContaining({
        phoneNumber: '380991112233',
        chatKind: 'direct'
      })
    );
  });

  it('should add call metadata columns to an existing messages table', () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-monitor-messages-'));
    const databasePath = path.join(tempDirectory, 'app.sqlite');
    const connection = new DatabaseSync(databasePath);

    connection.exec(EMPLOYEES_SCHEMA_SQL);
    connection.exec(`
      CREATE TABLE chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        contact_key TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        phone_number TEXT,
        last_message_timestamp INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, contact_key),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE chat_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_record_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        alias_chat_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, alias_chat_id),
        FOREIGN KEY (chat_record_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        chat_record_id INTEGER NOT NULL,
        external_message_id TEXT NOT NULL,
        source_chat_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        message_type TEXT NOT NULL DEFAULT 'chat',
        timestamp INTEGER,
        from_jid TEXT,
        to_jid TEXT,
        author_jid TEXT,
        ack INTEGER,
        has_media INTEGER NOT NULL DEFAULT 0,
        is_forwarded INTEGER NOT NULL DEFAULT 0,
        forwarding_score INTEGER NOT NULL DEFAULT 0,
        has_quoted_msg INTEGER NOT NULL DEFAULT 0,
        quoted_message_external_id TEXT,
        ingest_source TEXT NOT NULL DEFAULT 'live',
        raw_payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, external_message_id)
      );
    `);
    connection.close();

    database = createDatabase({
      databasePath,
      logger: createLogger()
    });

    const verificationConnection = new DatabaseSync(databasePath);
    const messageColumns = verificationConnection
      .prepare(`PRAGMA table_info(messages)`)
      .all() as Array<{ name: string }>;

    expect(messageColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['call_status', 'call_media_type'])
    );

    expect(() => {
      verificationConnection
        .prepare(`
          INSERT INTO messages (
            employee_id,
            chat_record_id,
            external_message_id,
            source_chat_id,
            direction,
            call_status
          )
          VALUES (1, 1, 'call:bad-status', '123@c.us', 'incoming', 'bad-status')
        `)
        .run();
    }).toThrow(/Invalid call_status/u);

    verificationConnection.close();
  });
});

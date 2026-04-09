export const EMPLOYEES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    display_name TEXT,
    phone_number TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    session_dir TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS employees_is_active_code_idx
    ON employees (is_active, code);
`;

export const CHATS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    contact_key TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    display_name TEXT,
    chat_kind TEXT NOT NULL DEFAULT 'direct',
    is_archived INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_id TEXT,
    last_message_preview TEXT,
    phone_number TEXT,
    last_polled_at TEXT,
    last_messages_synced_at TEXT,
    last_message_timestamp INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, contact_key),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS chats_employee_id_contact_key_idx
    ON chats (employee_id, contact_key);

  CREATE TABLE IF NOT EXISTS chat_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_record_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    alias_chat_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, alias_chat_id),
    FOREIGN KEY (chat_record_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS chat_aliases_chat_record_id_idx
    ON chat_aliases (chat_record_id);

  CREATE INDEX IF NOT EXISTS chats_employee_id_phone_number_idx
    ON chats (employee_id, phone_number);

  CREATE INDEX IF NOT EXISTS chats_employee_id_last_message_ts_idx
    ON chats (employee_id, last_message_timestamp DESC, id DESC);

  CREATE INDEX IF NOT EXISTS chats_employee_id_chat_kind_idx
    ON chats (employee_id, chat_kind);
`;

export const MESSAGES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    chat_record_id INTEGER NOT NULL,
    external_message_id TEXT NOT NULL,
    source_chat_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    message_type TEXT NOT NULL DEFAULT 'chat',
    call_status TEXT,
    call_media_type TEXT,
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
    UNIQUE(employee_id, external_message_id),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (chat_record_id) REFERENCES chats(id) ON DELETE CASCADE,
    CHECK(direction IN ('incoming', 'outgoing', 'system')),
    CHECK(call_status IN ('incoming', 'outgoing', 'missed') OR call_status IS NULL),
    CHECK(call_media_type IN ('voice', 'video') OR call_media_type IS NULL),
    CHECK(ingest_source IN ('live', 'poll'))
  );

  CREATE INDEX IF NOT EXISTS messages_chat_record_id_timestamp_idx
    ON messages (chat_record_id, timestamp DESC, id DESC);

  CREATE INDEX IF NOT EXISTS messages_employee_id_timestamp_idx
    ON messages (employee_id, timestamp DESC, id DESC);

  CREATE INDEX IF NOT EXISTS messages_chat_record_id_direction_timestamp_idx
    ON messages (chat_record_id, direction, timestamp DESC, id DESC);

  CREATE TRIGGER IF NOT EXISTS messages_call_status_insert_check
  BEFORE INSERT ON messages
  FOR EACH ROW
  WHEN NEW.call_status IS NOT NULL
    AND NEW.call_status NOT IN ('incoming', 'outgoing', 'missed')
  BEGIN
    SELECT RAISE(ABORT, 'Invalid call_status');
  END;

  CREATE TRIGGER IF NOT EXISTS messages_call_status_update_check
  BEFORE UPDATE ON messages
  FOR EACH ROW
  WHEN NEW.call_status IS NOT NULL
    AND NEW.call_status NOT IN ('incoming', 'outgoing', 'missed')
  BEGIN
    SELECT RAISE(ABORT, 'Invalid call_status');
  END;

  CREATE TRIGGER IF NOT EXISTS messages_call_media_type_insert_check
  BEFORE INSERT ON messages
  FOR EACH ROW
  WHEN NEW.call_media_type IS NOT NULL
    AND NEW.call_media_type NOT IN ('voice', 'video')
  BEGIN
    SELECT RAISE(ABORT, 'Invalid call_media_type');
  END;

  CREATE TRIGGER IF NOT EXISTS messages_call_media_type_update_check
  BEFORE UPDATE ON messages
  FOR EACH ROW
  WHEN NEW.call_media_type IS NOT NULL
    AND NEW.call_media_type NOT IN ('voice', 'video')
  BEGIN
    SELECT RAISE(ABORT, 'Invalid call_media_type');
  END;
`;

export const DATABASE_SCHEMA_SQL = `
  ${EMPLOYEES_SCHEMA_SQL}
  ${CHATS_SCHEMA_SQL}
  ${MESSAGES_SCHEMA_SQL}
`;

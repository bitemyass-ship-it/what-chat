import type { DatabaseSync } from 'node:sqlite';
import type {
  MessageRecord,
  MessagesRepository,
  UpsertMessageInput
} from './types';

interface MessageRow {
  id: number;
  employee_id: number;
  chat_record_id: number;
  external_message_id: string;
  source_chat_id: string;
  direction: 'incoming' | 'outgoing' | 'system';
  body: string;
  message_type: string;
  call_status: 'incoming' | 'outgoing' | 'missed' | null;
  call_media_type: 'voice' | 'video' | null;
  timestamp: number | null;
  from_jid: string | null;
  to_jid: string | null;
  author_jid: string | null;
  ack: number | null;
  has_media: number;
  is_forwarded: number;
  forwarding_score: number;
  has_quoted_msg: number;
  quoted_message_external_id: string | null;
  ingest_source: 'live' | 'poll';
  raw_payload_json: string | null;
  created_at: string;
  updated_at: string;
}

const MESSAGE_SELECT_COLUMNS = `
  m.id,
  m.employee_id,
  m.chat_record_id,
  m.external_message_id,
  m.source_chat_id,
  m.direction,
  m.body,
  m.message_type,
  m.call_status,
  m.call_media_type,
  m.timestamp,
  m.from_jid,
  m.to_jid,
  m.author_jid,
  m.ack,
  m.has_media,
  m.is_forwarded,
  m.forwarding_score,
  m.has_quoted_msg,
  m.quoted_message_external_id,
  m.ingest_source,
  m.raw_payload_json,
  m.created_at,
  m.updated_at
`;

const mapMessageRow = (row: MessageRow): MessageRecord => ({
  id: row.id,
  employeeId: row.employee_id,
  chatRecordId: row.chat_record_id,
  externalMessageId: row.external_message_id,
  sourceChatId: row.source_chat_id,
  direction: row.direction,
  body: row.body,
  messageType: row.message_type,
  callStatus: row.call_status,
  callMediaType: row.call_media_type,
  timestamp: row.timestamp,
  fromJid: row.from_jid,
  toJid: row.to_jid,
  authorJid: row.author_jid,
  ack: row.ack,
  hasMedia: row.has_media === 1,
  isForwarded: row.is_forwarded === 1,
  forwardingScore: row.forwarding_score,
  hasQuotedMsg: row.has_quoted_msg === 1,
  quotedMessageExternalId: row.quoted_message_external_id,
  ingestSource: row.ingest_source,
  rawPayloadJson: row.raw_payload_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const asMessageRow = (row: unknown): MessageRow => row as MessageRow;

const normalizeEmployeeCode = (employeeCode: string): string => {
  const normalizedEmployeeCode = employeeCode.trim();

  if (normalizedEmployeeCode === '') {
    throw new Error('Employee code is required');
  }

  return normalizedEmployeeCode;
};

const normalizeRequiredText = (value: string, fieldName: string): string => {
  const normalizedValue = value.trim();

  if (normalizedValue === '') {
    throw new Error(`${fieldName} is required`);
  }

  return normalizedValue;
};

const normalizeOptionalText = (value?: string | null): string | null | undefined => {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  return value;
};

const normalizeInteger = (value?: number | null): number | null | undefined => {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.trunc(value);
};

const normalizeBoolean = (value?: boolean): number | undefined => {
  if (typeof value !== 'boolean') {
    return undefined;
  }

  return value ? 1 : 0;
};

const normalizeDirection = (
  value: UpsertMessageInput['direction']
): 'incoming' | 'outgoing' | 'system' => {
  if (value === 'incoming' || value === 'outgoing' || value === 'system') {
    return value;
  }

  throw new Error(`Unsupported message direction: ${String(value)}`);
};

const normalizeIngestSource = (
  value?: UpsertMessageInput['ingestSource']
): 'live' | 'poll' => {
  if (!value || value === 'live') {
    return 'live';
  }

  if (value === 'poll') {
    return 'poll';
  }

  throw new Error(`Unsupported ingest source: ${String(value)}`);
};

const normalizeCallStatus = (
  value?: UpsertMessageInput['callStatus']
): 'incoming' | 'outgoing' | 'missed' | null | undefined => {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  if (value === 'incoming' || value === 'outgoing' || value === 'missed') {
    return value;
  }

  throw new Error(`Unsupported call status: ${String(value)}`);
};

const normalizeCallMediaType = (
  value?: UpsertMessageInput['callMediaType']
): 'voice' | 'video' | null | undefined => {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  if (value === 'voice' || value === 'video') {
    return value;
  }

  throw new Error(`Unsupported call media type: ${String(value)}`);
};

const resolveMonotonicInteger = (
  persistedValue: number | null,
  incomingValue: number | null | undefined
): number | null => {
  if (incomingValue === undefined) {
    return persistedValue;
  }

  if (persistedValue === null) {
    return incomingValue;
  }

  if (incomingValue === null) {
    return persistedValue;
  }

  return Math.max(persistedValue, incomingValue);
};

const resolvePreferredIngestSource = ({
  incomingValue,
  persistedValue
}: {
  incomingValue: 'live' | 'poll';
  persistedValue: 'live' | 'poll';
}): 'live' | 'poll' =>
  incomingValue === 'live' || persistedValue === 'live' ? 'live' : 'poll';

export const createMessagesRepository = (
  database: DatabaseSync
): MessagesRepository => {
  const findEmployeeIdByCodeStatement = database.prepare(`
    SELECT id
    FROM employees
    WHERE code = ?
  `);
  const findChatRecordIdByEmployeeIdAndAliasStatement = database.prepare(`
    SELECT c.id
    FROM chats c
    INNER JOIN chat_aliases a ON a.chat_record_id = c.id
    WHERE a.employee_id = ?
      AND a.alias_chat_id = ?
  `);
  const findMessageByIdStatement = database.prepare(`
    SELECT ${MESSAGE_SELECT_COLUMNS}
    FROM messages m
    WHERE m.id = ?
  `);
  const findByEmployeeIdAndExternalMessageIdStatement = database.prepare(`
    SELECT ${MESSAGE_SELECT_COLUMNS}
    FROM messages m
    WHERE m.employee_id = ?
      AND m.external_message_id = ?
  `);
  const insertMessageStatement = database.prepare(`
    INSERT INTO messages (
      employee_id,
      chat_record_id,
      external_message_id,
      source_chat_id,
      direction,
      body,
      message_type,
      call_status,
      call_media_type,
      timestamp,
      from_jid,
      to_jid,
      author_jid,
      ack,
      has_media,
      is_forwarded,
      forwarding_score,
      has_quoted_msg,
      quoted_message_external_id,
      ingest_source,
      raw_payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateMessageStatement = database.prepare(`
    UPDATE messages
    SET chat_record_id = ?,
        source_chat_id = ?,
        direction = ?,
        body = ?,
        message_type = ?,
        call_status = ?,
        call_media_type = ?,
        timestamp = ?,
        from_jid = ?,
        to_jid = ?,
        author_jid = ?,
        ack = ?,
        has_media = ?,
        is_forwarded = ?,
        forwarding_score = ?,
        has_quoted_msg = ?,
        quoted_message_external_id = ?,
        ingest_source = ?,
        raw_payload_json = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const listByEmployeeCodeAndChatRecordIdStatement = database.prepare(`
    SELECT ${MESSAGE_SELECT_COLUMNS}
    FROM messages m
    INNER JOIN employees e ON e.id = m.employee_id
    WHERE e.code = ?
      AND m.chat_record_id = ?
    ORDER BY
      CASE WHEN m.timestamp IS NULL THEN 1 ELSE 0 END ASC,
      m.timestamp DESC,
      m.id DESC
    LIMIT ? OFFSET ?
  `);
  const countByEmployeeCodeAndChatRecordIdStatement = database.prepare(`
    SELECT COUNT(*) AS total
    FROM messages m
    INNER JOIN employees e ON e.id = m.employee_id
    WHERE e.code = ?
      AND m.chat_record_id = ?
  `);

  const resolveEmployeeId = (employeeCode: string): number => {
    const result = findEmployeeIdByCodeStatement.get(
      normalizeEmployeeCode(employeeCode)
    ) as { id: number } | undefined;

    if (!result) {
      throw new Error(`Employee not found: ${employeeCode.trim()}`);
    }

    return result.id;
  };

  const resolveChatRecordId = (employeeId: number, chatId: string): number => {
    const result = findChatRecordIdByEmployeeIdAndAliasStatement.get(
      employeeId,
      normalizeRequiredText(chatId, 'Chat ID')
    ) as { id: number } | undefined;

    if (!result) {
      throw new Error(`Canonical chat not found for alias: ${chatId.trim()}`);
    }

    return result.id;
  };

  const getMessageById = (messageId: number): MessageRow | undefined => {
    const row = findMessageByIdStatement.get(messageId);
    return row ? asMessageRow(row) : undefined;
  };

  const runInTransaction = <T>(callback: () => T): T => {
    database.exec('BEGIN IMMEDIATE');

    try {
      const result = callback();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    countByEmployeeCodeAndChatRecordId(employeeCode: string, chatRecordId: number): number {
      const result = countByEmployeeCodeAndChatRecordIdStatement.get(
        normalizeEmployeeCode(employeeCode),
        chatRecordId
      ) as { total: number };

      return result.total;
    },

    findByEmployeeCodeAndExternalMessageId(
      employeeCode: string,
      externalMessageId: string
    ): MessageRecord | undefined {
      const employeeId = resolveEmployeeId(employeeCode);
      const row = findByEmployeeIdAndExternalMessageIdStatement.get(
        employeeId,
        normalizeRequiredText(externalMessageId, 'External message ID')
      );

      return row ? mapMessageRow(asMessageRow(row)) : undefined;
    },

    listByEmployeeCodeAndChatRecordId(
      employeeCode: string,
      chatRecordId: number,
      options?: { limit?: number; offset?: number }
    ): MessageRecord[] {
      const limit = normalizeInteger(options?.limit) ?? 100;
      const offset = normalizeInteger(options?.offset) ?? 0;

      return listByEmployeeCodeAndChatRecordIdStatement
        .all(normalizeEmployeeCode(employeeCode), chatRecordId, limit, offset)
        .map((row) => mapMessageRow(asMessageRow(row)));
    },

    upsertByEmployeeCode(input: UpsertMessageInput): MessageRecord {
      const employeeCode = normalizeEmployeeCode(input.employeeCode);
      const employeeId = resolveEmployeeId(employeeCode);
      const externalMessageId = normalizeRequiredText(
        input.externalMessageId,
        'External message ID'
      );
      const direction = normalizeDirection(input.direction);
      const sourceChatId = normalizeRequiredText(input.sourceChatId, 'Source chat ID');
      const chatRecordId = resolveChatRecordId(employeeId, input.chatId);
      const body = normalizeOptionalText(input.body) ?? '';
      const messageType = normalizeOptionalText(input.messageType) ?? 'chat';
      const callStatus = normalizeCallStatus(input.callStatus);
      const callMediaType = normalizeCallMediaType(input.callMediaType);
      const timestamp = normalizeInteger(input.timestamp);
      const fromJid = normalizeOptionalText(input.fromJid);
      const toJid = normalizeOptionalText(input.toJid);
      const authorJid = normalizeOptionalText(input.authorJid);
      const ack = normalizeInteger(input.ack);
      const hasMedia = normalizeBoolean(input.hasMedia);
      const isForwarded = normalizeBoolean(input.isForwarded);
      const forwardingScore = normalizeInteger(input.forwardingScore);
      const hasQuotedMsg = normalizeBoolean(input.hasQuotedMsg);
      const quotedMessageExternalId = normalizeOptionalText(input.quotedMessageExternalId);
      const ingestSource = normalizeIngestSource(input.ingestSource);
      const rawPayloadJson = normalizeOptionalText(input.rawPayloadJson);

      const message = runInTransaction(() => {
        const existingMessage = findByEmployeeIdAndExternalMessageIdStatement.get(
          employeeId,
          externalMessageId
        );

        if (!existingMessage) {
          const result = insertMessageStatement.run(
            employeeId,
            chatRecordId,
            externalMessageId,
            sourceChatId,
            direction,
            body,
            messageType,
            callStatus ?? null,
            callMediaType ?? null,
            timestamp ?? null,
            fromJid ?? null,
            toJid ?? null,
            authorJid ?? null,
            ack ?? null,
            hasMedia ?? 0,
            isForwarded ?? 0,
            forwardingScore ?? 0,
            hasQuotedMsg ?? 0,
            quotedMessageExternalId ?? null,
            ingestSource,
            rawPayloadJson ?? null
          ) as { lastInsertRowid: number };

          const createdMessage = getMessageById(Number(result.lastInsertRowid));

          if (!createdMessage) {
            throw new Error(`Unable to load created message: ${externalMessageId}`);
          }

          return createdMessage;
        }

        const persistedMessage = asMessageRow(existingMessage);

        updateMessageStatement.run(
          chatRecordId,
          sourceChatId,
          direction,
          body !== '' ? body : persistedMessage.body,
          messageType !== 'chat' ? messageType : persistedMessage.message_type,
          callStatus ?? persistedMessage.call_status,
          callMediaType ?? persistedMessage.call_media_type,
          resolveMonotonicInteger(persistedMessage.timestamp, timestamp),
          fromJid ?? persistedMessage.from_jid,
          toJid ?? persistedMessage.to_jid,
          authorJid ?? persistedMessage.author_jid,
          resolveMonotonicInteger(persistedMessage.ack, ack),
          hasMedia === 1 || persistedMessage.has_media === 1 ? 1 : 0,
          isForwarded === 1 || persistedMessage.is_forwarded === 1 ? 1 : 0,
          resolveMonotonicInteger(persistedMessage.forwarding_score, forwardingScore) ?? 0,
          hasQuotedMsg === 1 || persistedMessage.has_quoted_msg === 1 ? 1 : 0,
          quotedMessageExternalId ?? persistedMessage.quoted_message_external_id,
          resolvePreferredIngestSource({
            incomingValue: ingestSource,
            persistedValue: persistedMessage.ingest_source
          }),
          rawPayloadJson ?? persistedMessage.raw_payload_json,
          persistedMessage.id
        );

        const updatedMessage = getMessageById(persistedMessage.id);

        if (!updatedMessage) {
          throw new Error(`Unable to load updated message: ${externalMessageId}`);
        }

        return updatedMessage;
      });

      return mapMessageRow(message);
    }
  };
};

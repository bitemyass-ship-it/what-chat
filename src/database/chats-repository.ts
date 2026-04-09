import type { DatabaseSync } from 'node:sqlite';
import { buildChatContactKey, resolveReliablePhoneNumber } from '../utils/chat-identity';
import type {
  ChatAnalyticsRecord,
  ChatRecord,
  ChatsRepository,
  UpsertChatByEmployeeCodeInput
} from './types';

interface ChatRow {
  id: number;
  employee_id: number;
  contact_key: string;
  chat_id: string;
  display_name: string | null;
  chat_kind: string;
  is_archived: number;
  is_pinned: number;
  unread_count: number;
  last_message_id: string | null;
  last_message_preview: string | null;
  phone_number: string | null;
  last_polled_at: string | null;
  last_messages_synced_at: string | null;
  last_message_timestamp: number | null;
  created_at: string;
  updated_at: string;
}

interface ChatAliasRow {
  alias_chat_id: string;
}

interface ChatAnalyticsRow extends ChatRow {
  first_message_timestamp: number | null;
  incoming_messages: number;
  outgoing_messages: number;
  total_messages: number;
}

const CHAT_SELECT_COLUMNS = `
  c.id,
  c.employee_id,
  c.contact_key,
  c.chat_id,
  c.display_name,
  c.chat_kind,
  c.is_archived,
  c.is_pinned,
  c.unread_count,
  c.last_message_id,
  c.last_message_preview,
  c.phone_number,
  c.last_polled_at,
  c.last_messages_synced_at,
  c.last_message_timestamp,
  c.created_at,
  c.updated_at
`;

const mapChatRow = (row: ChatRow): ChatRecord => ({
  id: row.id,
  employeeId: row.employee_id,
  contactKey: row.contact_key,
  chatId: row.chat_id,
  displayName: row.display_name,
  chatKind: row.chat_kind,
  isArchived: row.is_archived === 1,
  isPinned: row.is_pinned === 1,
  unreadCount: row.unread_count,
  lastMessageId: row.last_message_id,
  lastMessagePreview: row.last_message_preview,
  phoneNumber: row.phone_number,
  lastPolledAt: row.last_polled_at,
  lastMessagesSyncedAt: row.last_messages_synced_at,
  lastMessageTimestamp: row.last_message_timestamp,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const asChatRow = (row: unknown): ChatRow => row as ChatRow;
const asChatAnalyticsRow = (row: unknown): ChatAnalyticsRow => row as ChatAnalyticsRow;
const asChatAliasRow = (row: unknown): ChatAliasRow => row as ChatAliasRow;

const normalizeEmployeeCode = (employeeCode: string): string => {
  const normalizedEmployeeCode = employeeCode.trim();

  if (normalizedEmployeeCode === '') {
    throw new Error('Employee code is required');
  }

  return normalizedEmployeeCode;
};

const mapChatAnalyticsRow = (row: ChatAnalyticsRow): ChatAnalyticsRecord => ({
  ...mapChatRow(row),
  firstMessageTimestamp: row.first_message_timestamp,
  incomingMessages: row.incoming_messages,
  outgoingMessages: row.outgoing_messages,
  totalMessages: row.total_messages
});

const normalizePaginationOptions = (
  options?: { limit: number; offset: number }
): { limit: number; offset: number } | undefined => {
  if (!options) {
    return undefined;
  }

  if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
    throw new Error('Pagination limit must be a positive integer');
  }

  if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
    throw new Error('Pagination offset must be a non-negative integer');
  }

  return options;
};

const normalizeChatId = (chatId: string): string => {
  const normalizedChatId = chatId.trim();

  if (normalizedChatId === '') {
    throw new Error('Chat ID is required');
  }

  return normalizedChatId;
};

const normalizeChatKind = (chatKind?: string): string => {
  const normalizedChatKind = chatKind?.trim();
  return normalizedChatKind === '' || !normalizedChatKind ? 'direct' : normalizedChatKind;
};

const normalizeOptionalChatKind = (chatKind?: string): string | undefined => {
  const normalizedChatKind = chatKind?.trim();
  return normalizedChatKind === '' || !normalizedChatKind ? undefined : normalizedChatKind;
};

const normalizeBoolean = (value?: boolean): number | undefined => {
  if (typeof value !== 'boolean') {
    return undefined;
  }

  return value ? 1 : 0;
};

const normalizeInteger = (value?: number | null): number | null | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return value === null ? null : undefined;
  }

  return Math.trunc(value);
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

const normalizeNonEmptyText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? undefined : normalizedValue;
};

const resolveLastMessageTimestamp = (
  ...values: Array<number | null | undefined>
): number | null => {
  const normalizedValues = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );

  if (normalizedValues.length === 0) {
    return null;
  }

  return Math.max(...normalizedValues.map((value) => Math.trunc(value)));
};

const isIncomingLastMessageNewer = ({
  incomingTimestamp,
  persistedTimestamp
}: {
  incomingTimestamp: number | null;
  persistedTimestamp: number | null;
}): boolean => {
  if (typeof incomingTimestamp === 'number') {
    return persistedTimestamp === null || incomingTimestamp >= persistedTimestamp;
  }

  return persistedTimestamp === null;
};

const selectLatestMessageMetadata = (
  ...chats: ChatRow[]
): {
  lastMessageId: string | null;
  lastMessagePreview: string | null;
  lastMessageTimestamp: number | null;
} => {
  const latestChat = chats.reduce<ChatRow | undefined>((currentLatestChat, candidateChat) => {
    if (!currentLatestChat) {
      return candidateChat;
    }

    const currentTimestamp = currentLatestChat.last_message_timestamp;
    const candidateTimestamp = candidateChat.last_message_timestamp;

    if (candidateTimestamp === null) {
      return currentLatestChat;
    }

    if (currentTimestamp === null || candidateTimestamp > currentTimestamp) {
      return candidateChat;
    }

    return currentLatestChat;
  }, undefined);

  return {
    lastMessageId: latestChat?.last_message_id ?? null,
    lastMessagePreview: latestChat?.last_message_preview ?? null,
    lastMessageTimestamp: latestChat?.last_message_timestamp ?? null
  };
};

const resolvePersistedContactKey = ({
  chatId,
  existingRows,
  reliablePhoneNumber
}: {
  chatId: string;
  existingRows: ChatRow[];
  reliablePhoneNumber?: string;
}): string => {
  if (reliablePhoneNumber) {
    return buildChatContactKey({
      chatId,
      phoneNumber: reliablePhoneNumber
    });
  }

  const phoneBasedContactKey = existingRows
    .map((row) => row.contact_key)
    .find((value) => value.startsWith('phone:'));

  if (phoneBasedContactKey) {
    return phoneBasedContactKey;
  }

  return buildChatContactKey({
    chatId
  });
};

export const createChatsRepository = (
  database: DatabaseSync
): ChatsRepository => {
  const hasMessagesTable = Boolean(
    database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'messages'
        `
      )
      .get()
  );
  const findEmployeeIdByCodeStatement = database.prepare(`
    SELECT id
    FROM employees
    WHERE code = ?
  `);
  const findChatByIdStatement = database.prepare(`
    SELECT ${CHAT_SELECT_COLUMNS}
    FROM chats c
    WHERE c.id = ?
  `);
  const findByEmployeeCodeAndChatIdStatement = database.prepare(`
    SELECT ${CHAT_SELECT_COLUMNS}
    FROM chats c
    INNER JOIN chat_aliases a ON a.chat_record_id = c.id
    WHERE a.employee_id = ?
      AND a.alias_chat_id = ?
  `);
  const findByEmployeeCodeAndRecordIdStatement = database.prepare(`
    SELECT ${CHAT_SELECT_COLUMNS}
    FROM chats c
    INNER JOIN employees e ON e.id = c.employee_id
    WHERE e.code = ?
      AND c.id = ?
  `);
  const countByEmployeeCodeStatement = database.prepare(`
    SELECT COUNT(*) AS total
    FROM chats c
    INNER JOIN employees e ON e.id = c.employee_id
    WHERE e.code = ?
  `);
  const findByEmployeeIdAndContactKeyStatement = database.prepare(`
    SELECT ${CHAT_SELECT_COLUMNS}
    FROM chats c
    WHERE c.employee_id = ?
      AND c.contact_key = ?
  `);
  const listByEmployeeCodeStatement = database.prepare(`
    SELECT ${CHAT_SELECT_COLUMNS}
    FROM chats c
    INNER JOIN employees e ON e.id = c.employee_id
    WHERE e.code = ?
    ORDER BY
      CASE WHEN c.last_message_timestamp IS NULL THEN 1 ELSE 0 END ASC,
      c.last_message_timestamp DESC,
      COALESCE(c.phone_number, c.chat_id) ASC,
      c.id ASC
  `);
  const listByEmployeeCodePaginatedStatement = database.prepare(`
    SELECT ${CHAT_SELECT_COLUMNS}
    FROM chats c
    INNER JOIN employees e ON e.id = c.employee_id
    WHERE e.code = ?
    ORDER BY
      CASE WHEN c.last_message_timestamp IS NULL THEN 1 ELSE 0 END ASC,
      c.last_message_timestamp DESC,
      COALESCE(c.phone_number, c.chat_id) ASC,
      c.id ASC
    LIMIT ?
    OFFSET ?
  `);
  const listAnalyticsByEmployeeCodeStatement = hasMessagesTable
    ? database.prepare(`
        SELECT
          ${CHAT_SELECT_COLUMNS},
          MIN(m.timestamp) AS first_message_timestamp,
          COALESCE(
            SUM(CASE WHEN m.message_type != 'call' AND m.direction = 'incoming' THEN 1 ELSE 0 END),
            0
          ) AS incoming_messages,
          COALESCE(
            SUM(CASE WHEN m.message_type != 'call' AND m.direction = 'outgoing' THEN 1 ELSE 0 END),
            0
          ) AS outgoing_messages,
          COALESCE(
            SUM(
              CASE
                WHEN m.message_type != 'call' AND m.direction IN ('incoming', 'outgoing') THEN 1
                ELSE 0
              END
            ),
            0
          ) AS total_messages
        FROM chats c
        INNER JOIN employees e ON e.id = c.employee_id
        LEFT JOIN messages m
          ON m.chat_record_id = c.id
         AND m.employee_id = c.employee_id
        WHERE e.code = ?
        GROUP BY c.id
        ORDER BY
          CASE WHEN c.last_message_timestamp IS NULL THEN 1 ELSE 0 END ASC,
          c.last_message_timestamp DESC,
          c.id ASC
      `)
    : undefined;
  const listAnalyticsByEmployeeCodePaginatedStatement = hasMessagesTable
    ? database.prepare(`
        SELECT
          ${CHAT_SELECT_COLUMNS},
          MIN(m.timestamp) AS first_message_timestamp,
          COALESCE(
            SUM(CASE WHEN m.message_type != 'call' AND m.direction = 'incoming' THEN 1 ELSE 0 END),
            0
          ) AS incoming_messages,
          COALESCE(
            SUM(CASE WHEN m.message_type != 'call' AND m.direction = 'outgoing' THEN 1 ELSE 0 END),
            0
          ) AS outgoing_messages,
          COALESCE(
            SUM(
              CASE
                WHEN m.message_type != 'call' AND m.direction IN ('incoming', 'outgoing') THEN 1
                ELSE 0
              END
            ),
            0
          ) AS total_messages
        FROM chats c
        INNER JOIN employees e ON e.id = c.employee_id
        LEFT JOIN messages m
          ON m.chat_record_id = c.id
         AND m.employee_id = c.employee_id
        WHERE e.code = ?
        GROUP BY c.id
        ORDER BY
          CASE WHEN c.last_message_timestamp IS NULL THEN 1 ELSE 0 END ASC,
          c.last_message_timestamp DESC,
          c.id ASC
        LIMIT ?
        OFFSET ?
      `)
    : undefined;
  const insertChatStatement = database.prepare(`
    INSERT INTO chats (
      employee_id,
      contact_key,
      chat_id,
      display_name,
      chat_kind,
      is_archived,
      is_pinned,
      unread_count,
      last_message_id,
      last_message_preview,
      phone_number,
      last_polled_at,
      last_messages_synced_at,
      last_message_timestamp
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateChatStatement = database.prepare(`
    UPDATE chats
    SET contact_key = ?,
        chat_id = ?,
        display_name = ?,
        chat_kind = ?,
        is_archived = ?,
        is_pinned = ?,
        unread_count = ?,
        last_message_id = ?,
        last_message_preview = ?,
        phone_number = ?,
        last_polled_at = ?,
        last_messages_synced_at = ?,
        last_message_timestamp = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const upsertAliasStatement = database.prepare(`
    INSERT INTO chat_aliases (
      chat_record_id,
      employee_id,
      alias_chat_id
    )
    VALUES (?, ?, ?)
    ON CONFLICT(employee_id, alias_chat_id) DO UPDATE SET
      chat_record_id = excluded.chat_record_id
  `);
  const listAliasesByChatRecordIdStatement = database.prepare(`
    SELECT alias_chat_id
    FROM chat_aliases
    WHERE chat_record_id = ?
  `);
  const deleteChatByIdStatement = database.prepare(`
    DELETE FROM chats
    WHERE id = ?
  `);
  const reattachMessagesToCanonicalChatStatement = hasMessagesTable
    ? database.prepare(`
        UPDATE messages
        SET chat_record_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE chat_record_id = ?
      `)
    : undefined;

  const resolveEmployeeId = (employeeCode: string): number => {
    const normalizedEmployeeCode = normalizeEmployeeCode(employeeCode);
    const result = findEmployeeIdByCodeStatement.get(normalizedEmployeeCode) as
      | { id: number }
      | undefined;

    if (!result) {
      throw new Error(`Employee not found: ${normalizedEmployeeCode}`);
    }

    return result.id;
  };

  const getChatById = (chatId: number): ChatRow | undefined => {
    const row = findChatByIdStatement.get(chatId);
    return row ? asChatRow(row) : undefined;
  };

  const findByEmployeeIdAndAlias = (
    employeeId: number,
    chatId: string
  ): ChatRow | undefined => {
    const row = findByEmployeeCodeAndChatIdStatement.get(
      employeeId,
      normalizeChatId(chatId)
    );

    return row ? asChatRow(row) : undefined;
  };

  const findByEmployeeIdAndContactKey = (
    employeeId: number,
    contactKey: string
  ): ChatRow | undefined => {
    const row = findByEmployeeIdAndContactKeyStatement.get(employeeId, contactKey);
    return row ? asChatRow(row) : undefined;
  };

  const upsertAlias = (
    chatRecordId: number,
    employeeId: number,
    chatId: string
  ): void => {
    upsertAliasStatement.run(chatRecordId, employeeId, normalizeChatId(chatId));
  };

  const insertChat = ({
    chatId,
    displayName,
    chatKind,
    contactKey,
    employeeId,
    isArchived,
    isPinned,
    lastMessageId,
    lastMessagePreview,
    lastMessageTimestamp,
    lastMessagesSyncedAt,
    lastPolledAt,
    phoneNumber,
    unreadCount
  }: {
    chatId: string;
    displayName: string | null;
    chatKind: string;
    contactKey: string;
    employeeId: number;
    isArchived: number;
    isPinned: number;
    lastMessageId: string | null;
    lastMessagePreview: string | null;
    lastMessageTimestamp: number | null;
    lastMessagesSyncedAt: string | null;
    lastPolledAt: string | null;
    phoneNumber: string | null;
    unreadCount: number;
  }): ChatRow => {
    const result = insertChatStatement.run(
      employeeId,
      contactKey,
      chatId,
      displayName,
      chatKind,
      isArchived,
      isPinned,
      unreadCount,
      lastMessageId,
      lastMessagePreview,
      phoneNumber,
      lastPolledAt,
      lastMessagesSyncedAt,
      lastMessageTimestamp
    ) as { lastInsertRowid: number };
    const createdChat = getChatById(Number(result.lastInsertRowid));

    if (!createdChat) {
      throw new Error(`Unable to load created chat: ${chatId}`);
    }

    return createdChat;
  };

  const updateChat = ({
    chat,
    contactKey,
    chatId,
    displayName,
    chatKind,
    isArchived,
    isPinned,
    lastMessageId,
    lastMessagePreview,
    phoneNumber,
    lastMessagesSyncedAt,
    lastPolledAt,
    lastMessageTimestamp,
    unreadCount
  }: {
    chat: ChatRow;
    contactKey: string;
    chatId: string;
    displayName: string | null;
    chatKind: string;
    isArchived: number;
    isPinned: number;
    lastMessageId: string | null;
    lastMessagePreview: string | null;
    phoneNumber: string | null;
    lastMessagesSyncedAt: string | null;
    lastPolledAt: string | null;
    lastMessageTimestamp: number | null;
    unreadCount: number;
  }): ChatRow => {
    updateChatStatement.run(
      contactKey,
      chatId,
      displayName,
      chatKind,
      isArchived,
      isPinned,
      unreadCount,
      lastMessageId,
      lastMessagePreview,
      phoneNumber,
      lastPolledAt,
      lastMessagesSyncedAt,
      lastMessageTimestamp,
      chat.id
    );

    const updatedChat = getChatById(chat.id);

    if (!updatedChat) {
      throw new Error(`Unable to load updated chat: ${chat.id}`);
    }

    return updatedChat;
  };

  const mergeChats = ({
    incomingChatId,
    incomingDisplayName,
    incomingChatKind,
    incomingIsArchived,
    incomingIsPinned,
    incomingLastMessageId,
    incomingLastMessagePreview,
    incomingLastMessageTimestamp,
    incomingLastMessagesSyncedAt,
    incomingLastPolledAt,
    incomingUnreadCount,
    reliablePhoneNumber,
    sourceChat,
    targetChat
  }: {
    incomingChatId: string;
    incomingDisplayName?: string | null;
    incomingChatKind?: string;
    incomingIsArchived?: number;
    incomingIsPinned?: number;
    incomingLastMessageId?: string | null;
    incomingLastMessagePreview?: string | null;
    incomingLastMessageTimestamp: number | null;
    incomingLastMessagesSyncedAt?: string | null;
    incomingLastPolledAt?: string | null;
    incomingUnreadCount?: number | null;
    reliablePhoneNumber?: string;
    sourceChat: ChatRow;
    targetChat: ChatRow;
  }): ChatRow => {
    const latestMessageMetadata = selectLatestMessageMetadata(targetChat, sourceChat);
    const mergedPhoneNumber =
      reliablePhoneNumber ?? targetChat.phone_number ?? sourceChat.phone_number;
    const mergedContactKey = resolvePersistedContactKey({
      chatId: incomingChatId,
      existingRows: [targetChat, sourceChat],
      reliablePhoneNumber: mergedPhoneNumber ?? undefined
    });
    const mergedLastMessageTimestamp = resolveLastMessageTimestamp(
      targetChat.last_message_timestamp,
      sourceChat.last_message_timestamp,
      incomingLastMessageTimestamp
    );
    const shouldReplaceLastMessageMetadata = isIncomingLastMessageNewer({
      incomingTimestamp: incomingLastMessageTimestamp,
      persistedTimestamp: latestMessageMetadata.lastMessageTimestamp
    });
    const mergedUnreadCount =
      incomingUnreadCount ?? targetChat.unread_count ?? sourceChat.unread_count ?? 0;
    const mergedChat = updateChat({
      chat: targetChat,
      contactKey: mergedContactKey,
      chatId: incomingChatId,
      displayName:
        incomingDisplayName !== undefined
          ? incomingDisplayName
          : targetChat.display_name ?? sourceChat.display_name,
      chatKind: incomingChatKind ?? targetChat.chat_kind ?? sourceChat.chat_kind,
      isArchived:
        incomingIsArchived ?? targetChat.is_archived ?? sourceChat.is_archived ?? 0,
      isPinned: incomingIsPinned ?? targetChat.is_pinned ?? sourceChat.is_pinned ?? 0,
      unreadCount: mergedUnreadCount,
      lastMessageId:
        shouldReplaceLastMessageMetadata && incomingLastMessageId
          ? incomingLastMessageId
          : latestMessageMetadata.lastMessageId,
      lastMessagePreview:
        shouldReplaceLastMessageMetadata && incomingLastMessagePreview
          ? incomingLastMessagePreview
          : latestMessageMetadata.lastMessagePreview,
      phoneNumber: mergedPhoneNumber ?? null,
      lastPolledAt:
        incomingLastPolledAt !== undefined
          ? incomingLastPolledAt
          : targetChat.last_polled_at ?? sourceChat.last_polled_at,
      lastMessagesSyncedAt:
        incomingLastMessagesSyncedAt !== undefined
          ? incomingLastMessagesSyncedAt
          : targetChat.last_messages_synced_at ?? sourceChat.last_messages_synced_at,
      lastMessageTimestamp: mergedLastMessageTimestamp
    });

    const sourceAliases = listAliasesByChatRecordIdStatement
      .all(sourceChat.id)
      .map((row) => asChatAliasRow(row).alias_chat_id);

    for (const aliasChatId of sourceAliases) {
      upsertAlias(mergedChat.id, mergedChat.employee_id, aliasChatId);
    }

    upsertAlias(mergedChat.id, mergedChat.employee_id, incomingChatId);

    if (reattachMessagesToCanonicalChatStatement) {
      reattachMessagesToCanonicalChatStatement.run(mergedChat.id, sourceChat.id);
    }

    deleteChatByIdStatement.run(sourceChat.id);

    const refreshedChat = getChatById(mergedChat.id);

    if (!refreshedChat) {
      throw new Error(`Unable to load merged chat: ${mergedChat.id}`);
    }

    return refreshedChat;
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
    countByEmployeeCode(employeeCode: string): number {
      const result = countByEmployeeCodeStatement.get(normalizeEmployeeCode(employeeCode)) as {
        total: number;
      };

      return result.total;
    },

    findByEmployeeCodeAndChatId(employeeCode: string, chatId: string): ChatRecord | undefined {
      const employeeId = resolveEmployeeId(employeeCode);
      const chat = findByEmployeeIdAndAlias(employeeId, chatId);
      return chat ? mapChatRow(chat) : undefined;
    },

    findByEmployeeCodeAndRecordId(
      employeeCode: string,
      chatRecordId: number
    ): ChatRecord | undefined {
      const row = findByEmployeeCodeAndRecordIdStatement.get(
        normalizeEmployeeCode(employeeCode),
        chatRecordId
      );

      return row ? mapChatRow(asChatRow(row)) : undefined;
    },

    listByEmployeeCode(employeeCode: string): ChatRecord[] {
      return listByEmployeeCodeStatement
        .all(normalizeEmployeeCode(employeeCode))
        .map((row) => mapChatRow(asChatRow(row)));
    },

    listAnalyticsByEmployeeCode(
      employeeCode: string,
      options?: { limit: number; offset: number }
    ): ChatAnalyticsRecord[] {
      const normalizedEmployeeCode = normalizeEmployeeCode(employeeCode);
      const normalizedPagination = normalizePaginationOptions(options);

      if (!listAnalyticsByEmployeeCodeStatement) {
        const rows = normalizedPagination
          ? listByEmployeeCodePaginatedStatement.all(
              normalizedEmployeeCode,
              normalizedPagination.limit,
              normalizedPagination.offset
            )
          : listByEmployeeCodeStatement.all(normalizedEmployeeCode);

        return rows
          .map((row) => mapChatRow(asChatRow(row)))
          .map((chat) => ({
            ...chat,
            firstMessageTimestamp: null,
            incomingMessages: 0,
            outgoingMessages: 0,
            totalMessages: 0
          }));
      }

      const rows = normalizedPagination
        ? listAnalyticsByEmployeeCodePaginatedStatement?.all(
            normalizedEmployeeCode,
            normalizedPagination.limit,
            normalizedPagination.offset
          ) ?? []
        : listAnalyticsByEmployeeCodeStatement.all(normalizedEmployeeCode);

      return rows
        .map((row) => mapChatAnalyticsRow(asChatAnalyticsRow(row)));
    },

    upsertByEmployeeCode(input: UpsertChatByEmployeeCodeInput): ChatRecord {
      const employeeId = resolveEmployeeId(input.employeeCode);
      const chatId = normalizeChatId(input.chatId);
      const reliablePhoneNumber = resolveReliablePhoneNumber({
        chatId,
        isPhoneNumberVerified: input.isPhoneNumberVerified,
        phoneNumber: input.phoneNumber
      });
      const displayName = normalizeOptionalText(input.displayName);
      const chatKind = normalizeOptionalChatKind(input.chatKind);
      const isArchived = normalizeBoolean(input.isArchived);
      const isPinned = normalizeBoolean(input.isPinned);
      const unreadCount = normalizeInteger(input.unreadCount) ?? undefined;
      const lastMessageId = normalizeNonEmptyText(input.lastMessageId);
      const lastMessagePreview = normalizeNonEmptyText(input.lastMessagePreview);
      const lastPolledAt = normalizeOptionalText(input.lastPolledAt);
      const lastMessagesSyncedAt = normalizeOptionalText(input.lastMessagesSyncedAt);
      const incomingLastMessageTimestamp = resolveLastMessageTimestamp(
        input.lastMessageTimestamp
      );

      const chat = runInTransaction(() => {
        const chatByAlias = findByEmployeeIdAndAlias(employeeId, chatId);
        const contactKey = resolvePersistedContactKey({
          chatId,
          existingRows: chatByAlias ? [chatByAlias] : [],
          reliablePhoneNumber
        });
        const chatByContactKey = findByEmployeeIdAndContactKey(employeeId, contactKey);

        if (!chatByAlias && !chatByContactKey) {
          const createdChat = insertChat({
            chatId,
            displayName: displayName ?? null,
            chatKind: chatKind ?? normalizeChatKind(),
            contactKey,
            employeeId,
            isArchived: isArchived ?? 0,
            isPinned: isPinned ?? 0,
            unreadCount: unreadCount ?? 0,
            lastMessageId: lastMessageId ?? null,
            lastMessagePreview: lastMessagePreview ?? null,
            lastMessageTimestamp: incomingLastMessageTimestamp,
            lastMessagesSyncedAt: lastMessagesSyncedAt ?? null,
            lastPolledAt: lastPolledAt ?? null,
            phoneNumber: reliablePhoneNumber ?? null
          });

          upsertAlias(createdChat.id, employeeId, chatId);
          return createdChat;
        }

        if (chatByAlias && chatByContactKey && chatByAlias.id !== chatByContactKey.id) {
          return mergeChats({
            incomingChatId: chatId,
            incomingDisplayName: displayName,
            incomingChatKind: chatKind,
            incomingIsArchived: isArchived,
            incomingIsPinned: isPinned,
            incomingLastMessageId: lastMessageId,
            incomingLastMessagePreview: lastMessagePreview,
            incomingLastMessageTimestamp,
            incomingLastMessagesSyncedAt: lastMessagesSyncedAt,
            incomingLastPolledAt: lastPolledAt,
            incomingUnreadCount: unreadCount,
            reliablePhoneNumber,
            sourceChat: chatByAlias,
            targetChat: chatByContactKey
          });
        }

        const baseChat = chatByAlias ?? chatByContactKey;

        if (!baseChat) {
          throw new Error(`Unable to resolve chat for ${chatId}`);
        }

        const persistedPhoneNumber = reliablePhoneNumber ?? baseChat.phone_number;
        const persistedContactKey = resolvePersistedContactKey({
          chatId,
          existingRows: [baseChat],
          reliablePhoneNumber: persistedPhoneNumber ?? undefined
        });
        const persistedLastMessageTimestamp = resolveLastMessageTimestamp(
          baseChat.last_message_timestamp,
          incomingLastMessageTimestamp
        );
        const shouldReplaceLastMessageMetadata = isIncomingLastMessageNewer({
          incomingTimestamp: incomingLastMessageTimestamp,
          persistedTimestamp: baseChat.last_message_timestamp
        });
        const updatedChat = updateChat({
          chat: baseChat,
          contactKey: persistedContactKey,
          chatId,
          displayName: displayName !== undefined ? displayName : baseChat.display_name,
          chatKind: chatKind ?? baseChat.chat_kind,
          isArchived: isArchived ?? baseChat.is_archived,
          isPinned: isPinned ?? baseChat.is_pinned,
          unreadCount: unreadCount ?? baseChat.unread_count,
          lastMessageId:
            shouldReplaceLastMessageMetadata && lastMessageId
              ? lastMessageId
              : baseChat.last_message_id,
          lastMessagePreview:
            shouldReplaceLastMessageMetadata && lastMessagePreview
              ? lastMessagePreview
              : baseChat.last_message_preview,
          phoneNumber: persistedPhoneNumber ?? null,
          lastPolledAt:
            lastPolledAt !== undefined ? lastPolledAt : baseChat.last_polled_at,
          lastMessagesSyncedAt:
            lastMessagesSyncedAt !== undefined
              ? lastMessagesSyncedAt
              : baseChat.last_messages_synced_at,
          lastMessageTimestamp: persistedLastMessageTimestamp
        });

        upsertAlias(updatedChat.id, employeeId, chatId);
        return updatedChat;
      });

      return mapChatRow(chat);
    }
  };
};

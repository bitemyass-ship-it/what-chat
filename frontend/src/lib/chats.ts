import {
  normalizeNullableText,
  parseEmployeeTimestamp
} from './employee-record';
import {
  fetchAuthenticatedBackend,
  resolveEmployeesApiBaseUrl
} from './backend-api';

export interface EmployeeChatListItem {
  chatRecordId: number;
  displayName: string | null;
  phoneNumber: string | null;
  rawChatLabel: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
}

export interface ChatMessageListItem {
  messageId: number;
  externalMessageId: string;
  timestamp: string | null;
  direction: 'incoming' | 'outgoing' | 'system';
  body: string;
  messageType: string;
}

export interface EmployeeChatsPage {
  items: EmployeeChatListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface EmployeeChatMessagesPage {
  items: ChatMessageListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface EmployeeChatsResult {
  chats: EmployeeChatListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error: string | null;
  notFound: boolean;
  unauthorized: boolean;
}

export interface EmployeeChatLookupResult {
  chat: EmployeeChatListItem | null;
  error: string | null;
  notFound: boolean;
  unauthorized: boolean;
}

export interface EmployeeChatMessagesResult {
  messages: ChatMessageListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  error: string | null;
  notFound: boolean;
  unauthorized: boolean;
}

const CHAT_API_TIMEOUT_MS = 5_000;
export const EMPLOYEE_CHATS_PAGE_SIZE = 20;
export const EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE = 20;
const INVALID_CHATS_RESPONSE_ERROR = 'Chats API returned invalid data';
const CHATS_LOAD_ERROR = 'Unable to load chats right now';
const CHATS_REACHABILITY_ERROR = 'Unable to reach chats endpoint';
const INVALID_CHAT_MESSAGES_RESPONSE_ERROR = 'Chat messages API returned invalid data';
const CHAT_MESSAGES_LOAD_ERROR = 'Unable to load chat messages right now';
const CHAT_MESSAGES_REACHABILITY_ERROR = 'Unable to reach chat messages endpoint';
export const CHAT_MESSAGE_PREVIEW_LIMIT = 35;
export const CHAT_MESSAGE_EMPTY_BODY_FALLBACK = 'No text content';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value > 0;

const isValidUtcIsoTimestamp = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
  parseEmployeeTimestamp(value) !== null;

const normalizeRequiredText = (value: unknown): string | null => {
  const normalizedValue = normalizeNullableText(value);
  return normalizedValue && normalizedValue !== '' ? normalizedValue : null;
};

const isMessageDirection = (
  value: unknown
): value is ChatMessageListItem['direction'] =>
  value === 'incoming' || value === 'outgoing' || value === 'system';

const buildEmployeeChatsApiPath = (code: string): string =>
  `/employees/${encodeURIComponent(code)}/chats`;

const buildEmployeeChatsApiPathWithPagination = (
  code: string,
  page = 1,
  pageSize = EMPLOYEE_CHATS_PAGE_SIZE
): string => {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(page));
  searchParams.set('pageSize', String(pageSize));

  return `${buildEmployeeChatsApiPath(code)}?${searchParams.toString()}`;
};

const buildEmployeeChatMessagesApiPath = (
  code: string,
  chatRecordId: string
): string =>
  `${buildEmployeeChatsApiPath(code)}/${encodeURIComponent(chatRecordId)}/messages`;

const buildEmployeeChatMessagesApiPathWithPagination = (
  code: string,
  chatRecordId: string,
  page = 1,
  pageSize = EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE
): string => {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(page));
  searchParams.set('pageSize', String(pageSize));

  return `${buildEmployeeChatMessagesApiPath(code, chatRecordId)}?${searchParams.toString()}`;
};

interface AuthenticatedChatsRequestOptions {
  apiBaseUrl?: string | null;
  authPassword?: string | null;
  fetchImpl?: typeof fetch;
}

interface GetEmployeeChatsOptions extends AuthenticatedChatsRequestOptions {
  page?: number;
  pageSize?: number;
}

interface GetEmployeeChatMessagesOptions
  extends AuthenticatedChatsRequestOptions {
  page?: number;
  pageSize?: number;
}

const resolveChatsApiUrl = (path: string): string | null => {
  if (typeof window !== 'undefined') {
    return `/api${path}`;
  }

  const apiBaseUrl = resolveEmployeesApiBaseUrl();

  if (!apiBaseUrl) {
    return null;
  }

  return `${apiBaseUrl}${path}`;
};

const fetchChatsApi = async (
  path: string,
  {
    apiBaseUrl = resolveEmployeesApiBaseUrl(),
    authPassword = null,
    fetchImpl = fetch
  }: AuthenticatedChatsRequestOptions = {}
): Promise<Response | 'config_error' | 'unauthorized'> => {
  if (typeof window !== 'undefined') {
    const requestUrl = resolveChatsApiUrl(path);

    if (!requestUrl) {
      return 'config_error';
    }

    return fetchImpl(requestUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(CHAT_API_TIMEOUT_MS)
    });
  }

  return fetchAuthenticatedBackend({
    apiBaseUrl,
    authPassword,
    fetchImpl,
    method: 'GET',
    path,
    timeoutMs: CHAT_API_TIMEOUT_MS
  });
};

export const deserializeEmployeeChatListItem = (
  value: unknown
): EmployeeChatListItem | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (!isFiniteNonNegativeInteger(value.chatRecordId)) {
    return null;
  }

  const rawChatLabel = normalizeRequiredText(value.rawChatLabel);

  if (!rawChatLabel) {
    return null;
  }

  const firstMessageAt = normalizeNullableText(value.firstMessageAt);
  const lastMessageAt = normalizeNullableText(value.lastMessageAt);

  if (firstMessageAt !== null && !isValidUtcIsoTimestamp(firstMessageAt)) {
    return null;
  }

  if (lastMessageAt !== null && !isValidUtcIsoTimestamp(lastMessageAt)) {
    return null;
  }

  if (
    !isFiniteNonNegativeInteger(value.totalMessages) ||
    !isFiniteNonNegativeInteger(value.incomingMessages) ||
    !isFiniteNonNegativeInteger(value.outgoingMessages)
  ) {
    return null;
  }

  if (value.totalMessages !== value.incomingMessages + value.outgoingMessages) {
    return null;
  }

  return {
    chatRecordId: value.chatRecordId,
    displayName: normalizeNullableText(value.displayName),
    phoneNumber: normalizeNullableText(value.phoneNumber),
    rawChatLabel,
    firstMessageAt,
    lastMessageAt,
    lastMessagePreview: normalizeNullableText(value.lastMessagePreview),
    totalMessages: value.totalMessages,
    incomingMessages: value.incomingMessages,
    outgoingMessages: value.outgoingMessages
  };
};

export const deserializeChatMessageListItem = (
  value: unknown
): ChatMessageListItem | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (!isFiniteNonNegativeInteger(value.messageId)) {
    return null;
  }

  const externalMessageId = normalizeRequiredText(value.externalMessageId);
  const messageType = normalizeRequiredText(value.messageType);
  const timestamp = normalizeNullableText(value.timestamp);

  if (!externalMessageId || !messageType || !isMessageDirection(value.direction)) {
    return null;
  }

  if (timestamp !== null && !isValidUtcIsoTimestamp(timestamp)) {
    return null;
  }

  if (typeof value.body !== 'string') {
    return null;
  }

  return {
    messageId: value.messageId,
    externalMessageId,
    timestamp,
    direction: value.direction,
    body: value.body,
    messageType
  };
};

export const normalizeEmployeeChatsPayload = (
  payload: unknown
): EmployeeChatListItem[] | null => {
  if (!Array.isArray(payload)) {
    return null;
  }

  const chats = payload.map((item) => deserializeEmployeeChatListItem(item));

  if (chats.some((chat) => chat === null)) {
    return null;
  }

  return chats.filter((chat): chat is EmployeeChatListItem => chat !== null);
};

export const normalizeEmployeeChatsPagePayload = (
  payload: unknown
): EmployeeChatsPage | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const items = normalizeEmployeeChatsPayload(payload.items);

  if (
    !items ||
    !isPositiveInteger(payload.page) ||
    !isPositiveInteger(payload.pageSize) ||
    !isFiniteNonNegativeInteger(payload.total) ||
    !isPositiveInteger(payload.totalPages)
  ) {
    return null;
  }

  if (items.length > payload.pageSize) {
    return null;
  }

  return {
    items,
    page: payload.page,
    pageSize: payload.pageSize,
    total: payload.total,
    totalPages: payload.totalPages
  };
};

export const normalizeChatMessagesPayload = (
  payload: unknown
): ChatMessageListItem[] | null => {
  if (!Array.isArray(payload)) {
    return null;
  }

  const messages = payload.map((item) => deserializeChatMessageListItem(item));

  if (messages.some((message) => message === null)) {
    return null;
  }

  return messages.filter((message): message is ChatMessageListItem => message !== null);
};

export const normalizeEmployeeChatMessagesPagePayload = (
  payload: unknown
): EmployeeChatMessagesPage | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const items = normalizeChatMessagesPayload(payload.items);

  if (
    !items ||
    !isPositiveInteger(payload.page) ||
    !isPositiveInteger(payload.pageSize) ||
    !isFiniteNonNegativeInteger(payload.total) ||
    !isPositiveInteger(payload.totalPages)
  ) {
    return null;
  }

  if (items.length > payload.pageSize) {
    return null;
  }

  return {
    items,
    page: payload.page,
    pageSize: payload.pageSize,
    total: payload.total,
    totalPages: payload.totalPages
  };
};

export const getEmployeeChats = async (
  code: string,
  {
    page = 1,
    pageSize = EMPLOYEE_CHATS_PAGE_SIZE,
    ...options
  }: GetEmployeeChatsOptions = {}
): Promise<EmployeeChatsResult> => {
  try {
    const response = await fetchChatsApi(
      buildEmployeeChatsApiPathWithPagination(code, page, pageSize),
      options
    );

    if (response === 'config_error') {
      return {
        chats: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: CHATS_LOAD_ERROR,
        notFound: false,
        unauthorized: false
      };
    }

    if (response === 'unauthorized' || response.status === 401) {
      return {
        chats: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: null,
        notFound: false,
        unauthorized: true
      };
    }

    if (response.status === 404) {
      return {
        chats: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: null,
        notFound: true,
        unauthorized: false
      };
    }

    if (!response.ok) {
      return {
        chats: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: CHATS_LOAD_ERROR,
        notFound: false,
        unauthorized: false
      };
    }

    const payload = await response.json();
    const chatsPage = normalizeEmployeeChatsPagePayload(payload);

    if (!chatsPage) {
      return {
        chats: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: INVALID_CHATS_RESPONSE_ERROR,
        notFound: false,
        unauthorized: false
      };
    }

    return {
      chats: chatsPage.items,
      page: chatsPage.page,
      pageSize: chatsPage.pageSize,
      total: chatsPage.total,
      totalPages: chatsPage.totalPages,
      error: null,
      notFound: false,
      unauthorized: false
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        chats: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: INVALID_CHATS_RESPONSE_ERROR,
        notFound: false,
        unauthorized: false
      };
    }

    return {
      chats: [],
      page,
      pageSize,
      total: 0,
      totalPages: 1,
      error: CHATS_REACHABILITY_ERROR,
      notFound: false,
      unauthorized: false
    };
  }
};

export const getEmployeeChatByRecordId = async (
  code: string,
  chatRecordId: number,
  options: AuthenticatedChatsRequestOptions = {}
): Promise<EmployeeChatLookupResult> => {
  const firstPageResult = await getEmployeeChats(code, {
    ...options,
    page: 1,
    pageSize: EMPLOYEE_CHATS_PAGE_SIZE
  });

  if (
    firstPageResult.unauthorized ||
    firstPageResult.notFound ||
    firstPageResult.error
  ) {
    return {
      chat: null,
      error: firstPageResult.error,
      notFound: firstPageResult.notFound,
      unauthorized: firstPageResult.unauthorized
    };
  }

  const firstPageMatch = firstPageResult.chats.find(
    (candidateChat) => candidateChat.chatRecordId === chatRecordId
  );

  if (firstPageMatch) {
    return {
      chat: firstPageMatch,
      error: null,
      notFound: false,
      unauthorized: false
    };
  }

  for (let page = 2; page <= firstPageResult.totalPages; page += 1) {
    const pageResult = await getEmployeeChats(code, {
      ...options,
      page,
      pageSize: EMPLOYEE_CHATS_PAGE_SIZE
    });

    if (pageResult.unauthorized || pageResult.notFound || pageResult.error) {
      return {
        chat: null,
        error: pageResult.error,
        notFound: pageResult.notFound,
        unauthorized: pageResult.unauthorized
      };
    }

    const matchedChat = pageResult.chats.find(
      (candidateChat) => candidateChat.chatRecordId === chatRecordId
    );

    if (matchedChat) {
      return {
        chat: matchedChat,
        error: null,
        notFound: false,
        unauthorized: false
      };
    }
  }

  return {
    chat: null,
    error: null,
    notFound: true,
    unauthorized: false
  };
};

export const getEmployeeChatMessages = async (
  code: string,
  chatRecordId: string,
  {
    page = 1,
    pageSize = EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE,
    ...options
  }: GetEmployeeChatMessagesOptions = {}
): Promise<EmployeeChatMessagesResult> => {
  try {
    const response = await fetchChatsApi(
      buildEmployeeChatMessagesApiPathWithPagination(
        code,
        chatRecordId,
        page,
        pageSize
      ),
      options
    );

    if (response === 'config_error') {
      return {
        messages: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: CHAT_MESSAGES_LOAD_ERROR,
        notFound: false,
        unauthorized: false
      };
    }

    if (response === 'unauthorized' || response.status === 401) {
      return {
        messages: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: null,
        notFound: false,
        unauthorized: true
      };
    }

    if (response.status === 404) {
      return {
        messages: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: null,
        notFound: true,
        unauthorized: false
      };
    }

    if (!response.ok) {
      return {
        messages: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: CHAT_MESSAGES_LOAD_ERROR,
        notFound: false,
        unauthorized: false
      };
    }

    const payload = await response.json();
    const messagesPage = normalizeEmployeeChatMessagesPagePayload(payload);

    if (!messagesPage) {
      return {
        messages: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: INVALID_CHAT_MESSAGES_RESPONSE_ERROR,
        notFound: false,
        unauthorized: false
      };
    }

    return {
      messages: messagesPage.items,
      page: messagesPage.page,
      pageSize: messagesPage.pageSize,
      total: messagesPage.total,
      totalPages: messagesPage.totalPages,
      error: null,
      notFound: false,
      unauthorized: false
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        messages: [],
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        error: INVALID_CHAT_MESSAGES_RESPONSE_ERROR,
        notFound: false,
        unauthorized: false
      };
    }

    return {
      messages: [],
      page,
      pageSize,
      total: 0,
      totalPages: 1,
      error: CHAT_MESSAGES_REACHABILITY_ERROR,
      notFound: false,
      unauthorized: false
    };
  }
};

export const resolveEmployeeChatLabel = (
  chat: Pick<EmployeeChatListItem, 'displayName' | 'phoneNumber' | 'rawChatLabel'>
): string => chat.displayName ?? chat.phoneNumber ?? chat.rawChatLabel;

export const formatEmployeeChatDateTime = (value: string | null): string => {
  const parsedDate = parseEmployeeTimestamp(value);

  if (!parsedDate) {
    return 'No messages yet';
  }

  return `${new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(parsedDate)} UTC`;
};

export const formatEmployeeChatCompactDateTime = (
  value: string | null
): string => {
  const parsedDate = parseEmployeeTimestamp(value);

  if (!parsedDate) {
    return 'No messages yet';
  }

  const datePart = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC'
  }).format(parsedDate);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(parsedDate);

  return `${datePart} ${timePart}`;
};

export const resolveFirstMessageAt = (
  chat: Pick<EmployeeChatListItem, 'firstMessageAt'>,
  messages: ChatMessageListItem[]
): string | null => {
  if (chat.firstMessageAt) {
    return chat.firstMessageAt;
  }

  const timestamps = messages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is string => timestamp !== null)
    .sort((leftValue, rightValue) => leftValue.localeCompare(rightValue));

  return timestamps[0] ?? null;
};

export const resolveLastMessageAt = (
  chat: Pick<EmployeeChatListItem, 'lastMessageAt'>,
  messages: ChatMessageListItem[]
): string | null => {
  if (chat.lastMessageAt) {
    return chat.lastMessageAt;
  }

  const timestamps = messages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is string => timestamp !== null)
    .sort((leftValue, rightValue) => rightValue.localeCompare(leftValue));

  return timestamps[0] ?? null;
};

const normalizePreviewSlice = (value: string): string => {
  const normalizedValue = value.replace(/\s+/gu, ' ').trim();
  return normalizedValue === '' ? value.trim() : normalizedValue;
};

export const getChatMessageDisplayBody = (body: string): string =>
  body === '' ? CHAT_MESSAGE_EMPTY_BODY_FALLBACK : body;

export const getChatMessagePreview = (
  body: string
): {
  isTruncated: boolean;
  preview: string;
} => {
  if (body === '') {
    return {
      isTruncated: false,
      preview: CHAT_MESSAGE_EMPTY_BODY_FALLBACK
    };
  }

  if (body.length <= CHAT_MESSAGE_PREVIEW_LIMIT) {
    return {
      isTruncated: false,
      preview: body
    };
  }

  return {
    isTruncated: true,
    preview: normalizePreviewSlice(body.slice(0, CHAT_MESSAGE_PREVIEW_LIMIT))
  };
};

export const getChatMessageDirectionLabel = (
  direction: ChatMessageListItem['direction']
): string => {
  if (direction === 'incoming') {
    return 'Incoming';
  }

  if (direction === 'outgoing') {
    return 'Outgoing';
  }

  return 'System';
};

export const getChatMessageTypeLabel = (messageType: string): string => {
  const normalizedType = messageType.trim().toLowerCase();

  if (normalizedType === 'chat') {
    return 'text';
  }

  if (normalizedType === 'call') {
    return 'call';
  }

  return normalizedType === '' ? 'unknown' : normalizedType;
};

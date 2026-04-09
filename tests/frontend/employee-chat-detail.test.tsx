import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import {
  EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE,
  CHAT_MESSAGE_PREVIEW_LIMIT,
  formatEmployeeChatDateTime,
  getEmployeeChatByRecordId,
  getEmployeeChatMessages,
  getChatMessageTypeLabel,
  type ChatMessageListItem,
  type EmployeeChatListItem
} from '../../frontend/src/lib/chats';
import EmployeeChat from '../../frontend/src/ui/Pages/EmployeeChat/EmployeeChat';
import ChatMessagesTable from '../../frontend/src/ui/Pages/EmployeeChat/components/ChatMessagesTable';
import FullMessageModal from '../../frontend/src/ui/Pages/EmployeeChat/components/FullMessageModal';

jest.mock('next/link', () => {
  const React = require('react') as typeof import('react');

  return {
    __esModule: true,
    default: ({
      children,
      href,
      ...props
    }: {
      children: ReactNode;
      href: string;
    }) => React.createElement('a', { href, ...props }, children)
  };
});

jest.mock('next/navigation', () => ({
  usePathname: () => '/employees/anna/chats/17',
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
    replace: jest.fn()
  }),
  useSearchParams: () => new URLSearchParams('page=1')
}));

const chat: EmployeeChatListItem = {
  chatRecordId: 17,
  displayName: 'Anna Thread',
  phoneNumber: '380991112233',
  rawChatLabel: '380991112233@c.us',
  firstMessageAt: '2026-03-30T08:15:00.000Z',
  lastMessageAt: '2026-03-31T09:41:22.000Z',
  lastMessagePreview: 'Latest Anna preview',
  totalMessages: 6,
  incomingMessages: 4,
  outgoingMessages: 2
};

const longMessageBody =
  'This message body is definitely longer than thirty-five characters.';

const messages: ChatMessageListItem[] = [
  {
    messageId: 2,
    externalMessageId: 'wamid-latest',
    timestamp: '2026-03-31T09:41:22.000Z',
    direction: 'outgoing',
    body: 'Latest message',
    messageType: 'chat'
  },
  {
    messageId: 1,
    externalMessageId: 'wamid-earliest',
    timestamp: '2026-03-30T08:15:00.000Z',
    direction: 'incoming',
    body: longMessageBody,
    messageType: 'image'
  }
];

describe('employee chat detail page UI', () => {
  const originalFetch = global.fetch;
  const authOptions = {
    authPassword: '0000'
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should render a compact chat summary block', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChat
        chat={chat}
        code="anna"
        chatRecordId="17"
        messages={messages}
        messagesPage={1}
        messagesPageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        messagesTotal={messages.length}
        messagesTotalPages={1}
        messagesError={null}
      />
    );

    expect(markup).toContain('Chat metrics');
    expect(markup).toContain('Anna Thread');
    expect(markup).toContain('First Message At');
    expect(markup).toContain(formatEmployeeChatDateTime('2026-03-30T08:15:00.000Z'));
    expect(markup).toContain('Last Message At');
    expect(markup).toContain(formatEmployeeChatDateTime(chat.lastMessageAt));
    expect(markup).toContain('Total Messages');
    expect(markup).toContain('>6<');
  });

  it('should render the expected messages table columns', () => {
    const markup = renderToStaticMarkup(
      <ChatMessagesTable
        chatRecordId="17"
        code="anna"
        error={null}
        messages={messages}
        page={1}
        pageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        total={messages.length}
        totalPages={1}
      />
    );

    expect(markup).toContain('Timestamp');
    expect(markup).toContain('Direction');
    expect(markup).toContain('Message');
    expect(markup).toContain('Type');
  });

  it('should preserve backend row order without applying client-side sorting', () => {
    const markup = renderToStaticMarkup(
      <ChatMessagesTable
        chatRecordId="17"
        code="anna"
        error={null}
        messages={messages}
        page={1}
        pageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        total={messages.length}
        totalPages={1}
      />
    );

    expect(markup.indexOf('Latest message')).toBeLessThan(
      markup.indexOf(longMessageBody.slice(0, CHAT_MESSAGE_PREVIEW_LIMIT))
    );
    expect(markup).not.toContain('↑');
    expect(markup).not.toContain('↓');
  });

  it('should render short messages inline without an expand control', () => {
    const markup = renderToStaticMarkup(
      <ChatMessagesTable
        chatRecordId="17"
        code="anna"
        error={null}
        messages={[
          {
            messageId: 3,
            externalMessageId: 'wamid-short',
            timestamp: '2026-03-31T09:40:00.000Z',
            direction: 'incoming',
            body: 'Short message body',
            messageType: 'chat'
          }
        ]}
        page={1}
        pageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        total={1}
        totalPages={1}
      />
    );

    expect(markup).toContain('Short message body');
    expect(markup).not.toContain('View full message');
  });

  it('should render call rows using the persisted body and call type label', () => {
    const markup = renderToStaticMarkup(
      <ChatMessagesTable
        chatRecordId="17"
        code="anna"
        error={null}
        messages={[
          {
            messageId: 4,
            externalMessageId: 'call:1',
            timestamp: '2026-03-31T09:50:00.000Z',
            direction: 'incoming',
            body: 'Missed call',
            messageType: 'call'
          }
        ]}
        page={1}
        pageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        total={1}
        totalPages={1}
      />
    );

    expect(markup).toContain('Missed call');
    expect(markup).toContain('Incoming');
    expect(markup).toContain('call');
    expect(markup).not.toContain('No text content');
  });

  it('should render truncated previews and an explicit full-message trigger only for long messages', () => {
    const markup = renderToStaticMarkup(
      <ChatMessagesTable
        chatRecordId="17"
        code="anna"
        error={null}
        messages={messages}
        page={1}
        pageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        total={messages.length}
        totalPages={1}
      />
    );

    expect(markup).toContain(longMessageBody.slice(0, CHAT_MESSAGE_PREVIEW_LIMIT));
    expect(markup).not.toContain(longMessageBody);
    expect(markup.match(/View full message/g)).toHaveLength(1);
  });

  it('should render the full original message body in a read-only modal', () => {
    const markup = renderToStaticMarkup(
      <FullMessageModal
        body={'Line one\nLine two\nLine three'}
        isOpen
        onClose={() => undefined}
      />
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('Full message');
    expect(markup).toContain('Line one\nLine two\nLine three');
    expect(markup).toContain('whitespace-pre-wrap');
  });

  it('should render the empty state when a chat has no messages', () => {
    const markup = renderToStaticMarkup(
      <ChatMessagesTable
        chatRecordId="17"
        code="anna"
        error={null}
        messages={[]}
        page={1}
        pageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        total={0}
        totalPages={1}
      />
    );

    expect(markup).toContain('No messages available yet');
  });

  it('should normalize call message types explicitly in the frontend helper', () => {
    expect(getChatMessageTypeLabel('chat')).toBe('text');
    expect(getChatMessageTypeLabel('call')).toBe('call');
    expect(getChatMessageTypeLabel('CALL')).toBe('call');
  });

  it('should show a neutral empty state when a page is out of range but messages exist', () => {
    const markup = renderToStaticMarkup(
      <ChatMessagesTable
        chatRecordId="17"
        code="anna"
        error={null}
        messages={[]}
        page={8}
        pageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        total={31}
        totalPages={2}
      />
    );

    expect(markup).toContain('No messages on this page');
    expect(markup).toContain('Page 8 of 2');
    expect(markup).toContain('>1</button>');
    expect(markup).toContain('>2</button>');
    expect(markup).toContain('>8</button>');
  });

  it('should render a pagination footer when more than one page exists', () => {
    const markup = renderToStaticMarkup(
      <ChatMessagesTable
        chatRecordId="17"
        code="anna"
        error={null}
        messages={messages}
        page={2}
        pageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        total={41}
        totalPages={3}
      />
    );

    expect(markup).toContain('Total:');
    expect(markup).toContain('>41<');
    expect(markup).toContain('Page 2 of 3');
    expect(markup).toContain('Messages pagination for chat 17 (anna)');
    expect(markup).toContain('>2</button>');
  });

  it('should render an inline error state when messages fail to load', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChat
        chat={chat}
        code="anna"
        chatRecordId="17"
        messages={[]}
        messagesPage={1}
        messagesPageSize={EMPLOYEE_CHAT_MESSAGES_PAGE_SIZE}
        messagesTotal={0}
        messagesTotalPages={1}
        messagesError="Unable to load chat messages right now"
      />
    );

    expect(markup).toContain('Unable to load chat messages right now');
    expect(markup).toContain('Back to employee');
  });

  it('should reject malformed message payloads safely in the frontend helper', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              messageId: 'broken',
              externalMessageId: 'wamid-1'
            }
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    ) as typeof fetch;

    await expect(getEmployeeChatMessages('anna', '17', authOptions)).resolves.toEqual({
      messages: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      error: 'Chat messages API returned invalid data',
      notFound: false,
      unauthorized: false
    });
  });

  it('should find a chat summary outside the first paginated chats page', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [],
            page: 1,
            pageSize: 20,
            total: 21,
            totalPages: 2
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [chat],
            page: 2,
            pageSize: 20,
            total: 21,
            totalPages: 2
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        )
      ) as typeof fetch;

    await expect(
      getEmployeeChatByRecordId('anna', chat.chatRecordId, authOptions)
    ).resolves.toEqual({
      chat,
      error: null,
      notFound: false,
      unauthorized: false
    });
  });
});

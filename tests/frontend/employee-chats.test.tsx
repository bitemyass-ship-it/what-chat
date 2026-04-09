import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatEmployeeChatCompactDateTime,
  getEmployeeChats,
  type EmployeeChatListItem
} from '../../frontend/src/lib/chats';
import EmployeeChatsPanel from '../../frontend/src/ui/Pages/Employee/components/EmployeeChatsPlaceholder';
import EmployeeChatsTable from '../../frontend/src/ui/Pages/Employee/components/EmployeeChatsTable';

jest.mock('next/navigation', () => ({
  usePathname: () => '/employees/anna',
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
    replace: jest.fn()
  }),
  useSearchParams: () => new URLSearchParams('')
}));

const createTableProps = () => ({
  chats,
  employeeCode: 'anna',
  error: null,
  isLoading: false,
  onPageChange: () => undefined,
  page: 1,
  pageSize: 20,
  total: chats.length,
  totalPages: 1
});

const chats: EmployeeChatListItem[] = [
  {
    chatRecordId: 11,
    displayName: 'Zelda Thread',
    phoneNumber: null,
    rawChatLabel: 'chat-zelda',
    firstMessageAt: '2026-03-30T09:41:22.000Z',
    lastMessageAt: '2026-03-31T09:41:22.000Z',
    lastMessagePreview: 'Latest Zelda preview',
    totalMessages: 5,
    incomingMessages: 3,
    outgoingMessages: 2
  },
  {
    chatRecordId: 12,
    displayName: 'Anna Thread',
    phoneNumber: null,
    rawChatLabel: 'chat-anna',
    firstMessageAt: '2026-03-29T09:41:22.000Z',
    lastMessageAt: '2026-03-31T09:41:22.000Z',
    lastMessagePreview: 'Latest Anna preview',
    totalMessages: 6,
    incomingMessages: 4,
    outgoingMessages: 2
  },
  {
    chatRecordId: 13,
    displayName: null,
    phoneNumber: '380991112233',
    rawChatLabel: 'chat-phone',
    firstMessageAt: '2026-03-28T09:41:22.000Z',
    lastMessageAt: '2026-04-01T09:41:22.000Z',
    lastMessagePreview: null,
    totalMessages: 7,
    incomingMessages: 5,
    outgoingMessages: 2
  },
  {
    chatRecordId: 14,
    displayName: null,
    phoneNumber: null,
    rawChatLabel: 'Fallback Only',
    firstMessageAt: null,
    lastMessageAt: null,
    lastMessagePreview: 'Should sort last',
    totalMessages: 0,
    incomingMessages: 0,
    outgoingMessages: 0
  }
];

describe('employee chats tab UI', () => {
  const originalFetch = global.fetch;
  const authOptions = {
    authPassword: '0000'
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should render a real chats table instead of placeholder-only copy', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsPanel
        employeeCode="anna"
        isWhatsappConnected
      />
    );

    expect(markup).toContain('User chats');
    expect(markup).toContain('<table');
    expect(markup).not.toContain(
      'Chat monitoring view will use the next backend endpoint.'
    );
  });

  it('should render the expected analytics columns', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
      />
    );

    expect(markup).toContain('Chat');
    expect(markup).toContain('Last Message At');
    expect(markup).toContain('Last Message Preview');
    expect(markup).toContain('Total Messages');
    expect(markup).toContain('Incoming');
    expect(markup).toContain('Outgoing');
    expect(markup).not.toContain('>Open<');
  });

  it('should preserve backend row order without applying client-side sorting', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
      />
    );

    const zeldaIndex = markup.indexOf('Zelda Thread');
    const annaIndex = markup.indexOf('Anna Thread');
    const phoneIndex = markup.indexOf('380991112233');
    const fallbackIndex = markup.indexOf('Fallback Only');

    expect(zeldaIndex).toBeGreaterThan(-1);
    expect(annaIndex).toBeGreaterThan(-1);
    expect(phoneIndex).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeGreaterThan(-1);
    expect(zeldaIndex).toBeLessThan(annaIndex);
    expect(annaIndex).toBeLessThan(phoneIndex);
    expect(phoneIndex).toBeLessThan(fallbackIndex);
    expect(markup).not.toContain('↑');
    expect(markup).not.toContain('↓');
  });

  it('should render the empty state when no chats are available', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
        chats={[]}
        total={0}
      />
    );

    expect(markup).toContain('No chats available yet');
  });

  it('should render a compact inline error without breaking the card shell', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
        chats={[]}
        error="Unable to load chats right now"
      />
    );

    expect(markup).toContain('Unable to load chats right now');
    expect(markup).toContain('<table');
  });

  it('should fall back from displayName to phoneNumber to rawChatLabel in the chat cell', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
      />
    );

    expect(markup).toContain('Anna Thread');
    expect(markup).toContain('380991112233');
    expect(markup).toContain('Fallback Only');
  });

  it('should make each chat row navigable without rendering a separate Open column', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
      />
    );

    expect(markup.match(/role="link"/g)).toHaveLength(chats.length);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(chats.length);
    expect(markup).not.toContain('>Open<');
  });

  it('should render a call-based last message preview as-is in the chats list', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
        chats={[
          {
            ...chats[0],
            chatRecordId: 99,
            lastMessagePreview: 'Missed call'
          }
        ]}
        total={1}
      />
    );

    expect(markup).toContain('Missed call');
    expect(markup).not.toContain('No messages yet');
  });

  it('should render a compact date and 24-hour time in the Last Message At column', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
      />
    );

    expect(markup).toContain(
      formatEmployeeChatCompactDateTime('2026-03-31T09:41:22.000Z')
    );
    expect(markup).toContain(
      formatEmployeeChatCompactDateTime('2026-04-01T09:41:22.000Z')
    );
    expect(markup).not.toContain('UTC');
  });

  it('should render a pagination footer when more than one page exists', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
        page={2}
        total={47}
        totalPages={3}
      />
    );

    expect(markup).toContain('Total:');
    expect(markup).toContain('>47<');
    expect(markup).toContain('Page 2 of 3');
    expect(markup).toContain('aria-label="Chats pagination"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('>2</button>');
  });

  it('should show a neutral empty state when a page is out of range but total chats exist', () => {
    const markup = renderToStaticMarkup(
      <EmployeeChatsTable
        {...createTableProps()}
        chats={[]}
        page={9}
        total={31}
        totalPages={2}
      />
    );

    expect(markup).toContain('No chats on this page');
    expect(markup).toContain('Page 9 of 2');
    expect(markup).toContain('>1</button>');
    expect(markup).toContain('>2</button>');
    expect(markup).toContain('>9</button>');
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
    expect(markup).not.toContain(
      'Chats will appear here after the stored message history is ingested.'
    );
  });

  it('should reject malformed chat payloads safely in the frontend helper', async () => {
    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              chatRecordId: 'broken',
              rawChatLabel: 'chat-bad'
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

    await expect(getEmployeeChats('anna', authOptions)).resolves.toEqual({
      chats: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 1,
      error: 'Chats API returned invalid data',
      notFound: false,
      unauthorized: false
    });
  });
});

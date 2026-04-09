import { GET } from '../../frontend/src/app/api/employees/[code]/chats/[chatRecordId]/messages/route';
import { AUTH_COOKIE_NAME, AUTH_HEADER_NAME } from '../../frontend/src/lib/auth';

describe('frontend employee chat messages API proxy route', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EMPLOYEES_API_BASE_URL: 'http://api.example.com///'
    };
    global.fetch = jest.fn() as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('should forward GET /api/employees/[code]/chats/[chatRecordId]/messages and preserve backend status/body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              messageId: 2,
              externalMessageId: 'wamid-latest',
              timestamp: '2026-03-31T09:41:22.000Z',
              direction: 'outgoing',
              body: 'Latest message',
              messageType: 'chat'
            }
          ],
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
    );

    const response = await GET(
      new Request('http://localhost/api/employees/anna/chats/17/messages?page=2&pageSize=20', {
        method: 'GET',
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=0000`
        }
      }) as never,
      {
        params: Promise.resolve({
          code: 'anna',
          chatRecordId: '17'
        })
      }
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.example.com/employees/anna/chats/17/messages?page=2&pageSize=20',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
        cache: 'no-store',
        signal: expect.any(AbortSignal)
      })
    );
    const requestHeaders = (global.fetch as jest.Mock).mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get(AUTH_HEADER_NAME)).toBe('0000');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            messageId: 2
          })
        ],
        page: 2,
        pageSize: 20,
        total: 21,
        totalPages: 2
      })
    );
  });
});

import { DELETE } from '../../frontend/src/app/api/employees/[code]/route';
import { POST } from '../../frontend/src/app/api/employees/route';
import { AUTH_COOKIE_NAME, AUTH_HEADER_NAME } from '../../frontend/src/lib/auth';

describe('frontend employee API proxy routes', () => {
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

  it('should forward POST /api/employees and preserve backend status/body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          code: 'anna',
          displayName: 'Anna Petrova',
          phoneNumber: null,
          isActive: false,
          sessionDir: null,
          createdAt: '2026-03-31T10:00:00Z',
          updatedAt: '2026-03-31T10:00:00Z'
        }),
        {
          status: 201,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    );

    const response = await POST(
      new Request('http://localhost/api/employees', {
        method: 'POST',
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=0000`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          displayName: 'Anna Petrova'
        })
      }) as never
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.example.com/employees',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
        body: JSON.stringify({
          displayName: 'Anna Petrova'
        }),
        cache: 'no-store',
        signal: expect.any(AbortSignal)
      })
    );
    const requestHeaders = (global.fetch as jest.Mock).mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get('content-type')).toBe('application/json');
    expect(requestHeaders.get(AUTH_HEADER_NAME)).toBe('0000');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        code: 'anna'
      })
    );
  });

  it('should forward DELETE /api/employees/[code] and preserve backend errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Employee not found: anna' }), {
        status: 404,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const response = await DELETE(
      new Request('http://localhost/api/employees/anna', {
        method: 'DELETE',
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=0000`
        }
      }) as never,
      {
        params: Promise.resolve({
          code: 'anna'
        })
      }
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.example.com/employees/anna',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.any(Headers),
        cache: 'no-store',
        signal: expect.any(AbortSignal)
      })
    );
    const requestHeaders = (global.fetch as jest.Mock).mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get(AUTH_HEADER_NAME)).toBe('0000');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Employee not found: anna'
    });
  });

  it('should reject proxy requests when the auth cookie is missing', async () => {
    const response = await POST(
      new Request('http://localhost/api/employees', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          displayName: 'Anna Petrova'
        })
      }) as never
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized'
    });
  });
});

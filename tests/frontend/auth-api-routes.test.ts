import {
  AUTH_COOKIE_NAME,
  AUTH_HEADER_NAME
} from '../../frontend/src/lib/auth';
import { POST as LOGIN_POST } from '../../frontend/src/app/api/auth/login/route';
import { POST as LOGOUT_POST } from '../../frontend/src/app/api/auth/logout/route';

describe('frontend auth API routes', () => {
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

  it('should validate the password through /auth/check and store the auth cookie on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(null, {
        status: 204
      })
    );

    const response = await LOGIN_POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          password: '0000'
        })
      })
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.example.com/auth/check',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
        cache: 'no-store',
        signal: expect.any(AbortSignal)
      })
    );
    const requestHeaders = (global.fetch as jest.Mock).mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get(AUTH_HEADER_NAME)).toBe('0000');
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_COOKIE_NAME}=0000`);
  });

  it('should reject blank passwords before calling the backend auth check', async () => {
    const response = await LOGIN_POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          password: '   '
        })
      })
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Password is required'
    });
  });

  it('should keep invalid password errors stable and avoid setting a live cookie', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const response = await LOGIN_POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          password: 'wrong'
        })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid password'
    });
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_COOKIE_NAME}=;`);
  });

  it('should clear the auth cookie on logout', async () => {
    const response = await LOGOUT_POST();

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_COOKIE_NAME}=;`);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

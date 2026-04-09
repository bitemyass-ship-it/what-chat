import { NextResponse } from 'next/server';
import {
  AUTH_ENDPOINT_UNREACHABLE_ERROR,
  INVALID_PASSWORD_ERROR,
  PASSWORD_REQUIRED_ERROR,
  clearAuthCookie,
  setAuthCookie
} from '@/lib/auth';
import { fetchAuthenticatedBackend } from '@/lib/backend-api';

export async function POST(request: Request): Promise<NextResponse> {
  let password: string;

  try {
    const payload = (await request.json()) as { password?: unknown };

    if (typeof payload.password !== 'string' || payload.password.trim() === '') {
      return NextResponse.json(
        {
          error: PASSWORD_REQUIRED_ERROR
        },
        {
          status: 400
        }
      );
    }

    password = payload.password;
  } catch {
    return NextResponse.json(
      {
        error: PASSWORD_REQUIRED_ERROR
      },
      {
        status: 400
      }
    );
  }

  try {
    const authResponse = await fetchAuthenticatedBackend({
      authPassword: password,
      method: 'GET',
      path: '/auth/check',
      timeoutMs: 5_000
    });

    if (authResponse === 'config_error') {
      return NextResponse.json(
        {
          error: 'Employee API is not configured'
        },
        {
          status: 500
        }
      );
    }

    if (authResponse === 'unauthorized' || authResponse.status === 401) {
      const response = NextResponse.json(
        {
          error: INVALID_PASSWORD_ERROR
        },
        {
          status: 401
        }
      );
      clearAuthCookie(response);
      return response;
    }

    if (!authResponse.ok) {
      return NextResponse.json(
        {
          error: AUTH_ENDPOINT_UNREACHABLE_ERROR
        },
        {
          status: 502
        }
      );
    }

    const response = new NextResponse(null, {
      status: 204
    });
    setAuthCookie(response, password);
    return response;
  } catch {
    return NextResponse.json(
      {
        error: AUTH_ENDPOINT_UNREACHABLE_ERROR
      },
      {
        status: 502
      }
    );
  }
}

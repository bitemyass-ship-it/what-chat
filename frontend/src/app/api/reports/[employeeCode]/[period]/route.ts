import { NextResponse, type NextRequest } from 'next/server';
import { proxyProtectedEmployeeApiRequest } from '@/app/api/employees/proxy';
import { UNAUTHORIZED_ERROR, getAuthPasswordFromRequest } from '@/lib/auth';
import { fetchAuthenticatedBackend } from '@/lib/backend-api';

const DOWNLOAD_TIMEOUT_MS = 15_000;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ employeeCode: string; period: string }> }
) {
  const { employeeCode, period } = await context.params;
  const authPassword = getAuthPasswordFromRequest(request);

  if (!authPassword) {
    return NextResponse.json({ error: UNAUTHORIZED_ERROR }, { status: 401 });
  }

  const backendPath = `/reports/${encodeURIComponent(employeeCode)}/${encodeURIComponent(period)}`;

  let backendResponse: Response;

  try {
    const result = await fetchAuthenticatedBackend({
      authPassword,
      method: 'GET',
      path: backendPath,
      timeoutMs: DOWNLOAD_TIMEOUT_MS
    });

    if (result === 'config_error') {
      return NextResponse.json(
        { error: 'Employee API is not configured' },
        { status: 500 }
      );
    }

    if (result === 'unauthorized') {
      return NextResponse.json({ error: UNAUTHORIZED_ERROR }, { status: 401 });
    }

    backendResponse = result;
  } catch (error) {
    console.error('Report download proxy failed', {
      employeeCode,
      period,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Unable to reach employee API' },
      { status: 502 }
    );
  }

  if (!backendResponse.ok) {
    const body = await backendResponse.text();

    return new NextResponse(body || null, {
      status: backendResponse.status,
      headers: {
        'content-type':
          backendResponse.headers.get('content-type') ?? 'application/json'
      }
    });
  }

  const buffer = await backendResponse.arrayBuffer();
  const headers: Record<string, string> = {
    'content-type':
      backendResponse.headers.get('content-type') ??
      'application/octet-stream'
  };

  const contentDisposition = backendResponse.headers.get('content-disposition');

  if (contentDisposition) {
    headers['content-disposition'] = contentDisposition;
  }

  const contentLength = backendResponse.headers.get('content-length');

  if (contentLength) {
    headers['content-length'] = contentLength;
  }

  return new NextResponse(buffer, {
    status: backendResponse.status,
    headers
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ employeeCode: string; period: string }> }
) {
  const { employeeCode, period } = await context.params;

  return proxyProtectedEmployeeApiRequest(
    request,
    `/reports/${encodeURIComponent(employeeCode)}/${encodeURIComponent(period)}`,
    {
      employeeCode,
      period,
      scope: 'report-export'
    },
    'POST'
  );
}

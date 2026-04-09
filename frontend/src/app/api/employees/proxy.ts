import { NextResponse, type NextRequest } from 'next/server';
import { UNAUTHORIZED_ERROR, getAuthPasswordFromRequest } from '@/lib/auth';
import { fetchAuthenticatedBackend } from '@/lib/backend-api';

const EMPLOYEE_PROXY_TIMEOUT_MS = 5_000;
export const WHATSAPP_SESSION_PROXY_TIMEOUT_MS = 30_000;

const createProxyErrorResponse = (
  message: string,
  status = 500
): NextResponse =>
  NextResponse.json(
    {
      error: message
    },
    {
      status
    }
  );

const buildProxyResponse = async (backendResponse: Response): Promise<NextResponse> => {
  const payload = await backendResponse.text();
  const contentType = backendResponse.headers.get('content-type');

  return new NextResponse(payload || null, {
    status: backendResponse.status,
    headers: contentType
      ? {
          'content-type': contentType
        }
      : undefined
  });
};

const createRequestInit = async (
  request: NextRequest,
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE'
): Promise<{
  body: BodyInit | undefined;
  contentType: string | null;
}> => {
  const shouldForwardBody = method === 'PATCH' || method === 'POST';

  return {
    contentType: shouldForwardBody ? request.headers.get('content-type') : null,
    body: shouldForwardBody ? await request.text() : undefined,
  };
};

export const proxyProtectedEmployeeApiRequest = async (
  request: NextRequest,
  path: string,
  logContext: Record<string, unknown>,
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE',
  timeoutMs = EMPLOYEE_PROXY_TIMEOUT_MS
): Promise<NextResponse> => {
  const authPassword = getAuthPasswordFromRequest(request);

  if (!authPassword) {
    return createProxyErrorResponse(UNAUTHORIZED_ERROR, 401);
  }

  try {
    const { body, contentType } = await createRequestInit(request, method);
    const backendResponse = await fetchAuthenticatedBackend({
      authPassword,
      body,
      contentType,
      method,
      path,
      timeoutMs
    });

    if (backendResponse === 'config_error') {
      return createProxyErrorResponse('Employee API is not configured');
    }

    if (backendResponse === 'unauthorized') {
      return createProxyErrorResponse(UNAUTHORIZED_ERROR, 401);
    }

    return buildProxyResponse(backendResponse);
  } catch (error) {
    console.error('Employee API proxy request failed', {
      ...logContext,
      method,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return createProxyErrorResponse('Unable to reach employee API', 502);
  }
};

export const proxyEmployeesCollectionRequest = async (
  request: NextRequest,
  method: 'POST'
): Promise<NextResponse> => {
  return proxyProtectedEmployeeApiRequest(
    request,
    '/employees',
    {
      scope: 'employees'
    },
    method
  );
};

export const proxyEmployeeRequest = async (
  request: NextRequest,
  code: string,
  method: 'GET' | 'PATCH' | 'DELETE'
): Promise<NextResponse> => {
  return proxyProtectedEmployeeApiRequest(
    request,
    `/employees/${encodeURIComponent(code)}`,
    {
      code
    },
    method
  );
};

export const proxyEmployeeChatsRequest = async (
  request: NextRequest,
  code: string
): Promise<NextResponse> => {
  const search =
    'nextUrl' in request && request.nextUrl
      ? request.nextUrl.search
      : new URL(request.url).search;

  return proxyProtectedEmployeeApiRequest(
    request,
    `/employees/${encodeURIComponent(code)}/chats${search}`,
    {
      code,
      scope: 'employee-chats'
    },
    'GET'
  );
};

export const proxyEmployeeChatMessagesRequest = async (
  request: NextRequest,
  code: string,
  chatRecordId: string
): Promise<NextResponse> => {
  const search =
    'nextUrl' in request && request.nextUrl
      ? request.nextUrl.search
      : new URL(request.url).search;

  return proxyProtectedEmployeeApiRequest(
    request,
    `/employees/${encodeURIComponent(code)}/chats/${encodeURIComponent(chatRecordId)}/messages${search}`,
    {
      code,
      chatRecordId,
      scope: 'employee-chat-messages'
    },
    'GET'
  );
};

import { type NextRequest } from 'next/server';
import { WHATSAPP_SESSION_PROXY_TIMEOUT_MS, proxyProtectedEmployeeApiRequest } from '../../proxy';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
){
  const { code } = await context.params;
  return proxyProtectedEmployeeApiRequest(
    request,
    `/employees/${encodeURIComponent(code)}/whatsapp-session`,
    {
      code,
      scope: 'employee-whatsapp-session'
    },
    'GET',
    WHATSAPP_SESSION_PROXY_TIMEOUT_MS
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
){
  const { code } = await context.params;
  return proxyProtectedEmployeeApiRequest(
    request,
    `/employees/${encodeURIComponent(code)}/whatsapp-session`,
    {
      code,
      scope: 'employee-whatsapp-session'
    },
    'POST',
    WHATSAPP_SESSION_PROXY_TIMEOUT_MS
  );
}

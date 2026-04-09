import { type NextRequest } from 'next/server';
import { proxyEmployeeChatsRequest } from '../../proxy';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  return proxyEmployeeChatsRequest(request, code);
}

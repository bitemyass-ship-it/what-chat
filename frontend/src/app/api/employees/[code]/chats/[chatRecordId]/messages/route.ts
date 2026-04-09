import { type NextRequest } from 'next/server';
import { proxyEmployeeChatMessagesRequest } from '../../../../proxy';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string; chatRecordId: string }> }
) {
  const { code, chatRecordId } = await context.params;
  return proxyEmployeeChatMessagesRequest(request, code, chatRecordId);
}

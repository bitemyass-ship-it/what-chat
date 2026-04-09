import { type NextRequest } from 'next/server';
import { proxyEmployeeRequest } from '../proxy';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  return proxyEmployeeRequest(request, code, 'GET');
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  return proxyEmployeeRequest(request, code, 'PATCH');
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  return proxyEmployeeRequest(request, code, 'DELETE');
}

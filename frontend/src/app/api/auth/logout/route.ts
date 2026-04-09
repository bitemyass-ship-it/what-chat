import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

export async function POST(): Promise<NextResponse> {
  const response = new NextResponse(null, {
    status: 204
  });

  clearAuthCookie(response);
  return response;
}

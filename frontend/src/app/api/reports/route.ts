import { type NextRequest } from 'next/server';
import { proxyProtectedEmployeeApiRequest } from '@/app/api/employees/proxy';

export async function GET(request: NextRequest) {
  return proxyProtectedEmployeeApiRequest(
    request,
    '/reports',
    { scope: 'report-list' },
    'GET'
  );
}

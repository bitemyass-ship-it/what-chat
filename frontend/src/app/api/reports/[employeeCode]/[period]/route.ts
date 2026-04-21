import { type NextRequest } from 'next/server';
import { proxyProtectedEmployeeApiRequest } from '@/app/api/employees/proxy';

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

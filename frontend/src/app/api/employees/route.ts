import { type NextRequest } from 'next/server';
import { proxyEmployeesCollectionRequest } from './proxy';

export async function POST(request: NextRequest) {
  return proxyEmployeesCollectionRequest(request, 'POST');
}

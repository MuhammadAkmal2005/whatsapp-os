import { NextResponse } from 'next/server';

import { checkReadiness } from '@/server/services/health/health.service';

export async function GET(): Promise<NextResponse> {
  const { status, body } = await checkReadiness();
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Content-Type': 'application/json',
    },
  });
}

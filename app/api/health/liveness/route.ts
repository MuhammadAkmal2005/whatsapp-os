import { NextResponse } from 'next/server';

import { checkLiveness } from '@/server/services/health/health.service';

export function GET(): NextResponse {
  const body = checkLiveness();
  return NextResponse.json(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Content-Type': 'application/json',
    },
  });
}

import { NextResponse, type NextRequest } from 'next/server';

import { metricsRegistry } from '@/server/telemetry/metrics';

export function GET(request: NextRequest): Response {
  const { searchParams } = new URL(request.url);
  const accept = request.headers.get('accept') || '';
  const format = searchParams.get('format');

  if (format === 'json' || accept.includes('application/json')) {
    return NextResponse.json(metricsRegistry.toJSON(), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': 'application/json',
      },
    });
  }

  const prometheusText = metricsRegistry.toPrometheusText();
  return new Response(prometheusText, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  });
}

/**
 * Request metadata for server actions and route handlers.
 *
 * The service layer wants the caller's IP and user-agent for audit entries and
 * rate-limit identifiers, but it must stay framework-free — it cannot reach for
 * `next/headers` itself. So the adapter layer reads them here and passes them
 * down as plain data.
 */

import 'server-only';

import { headers } from 'next/headers';

import { clientIpFrom } from '@/server/ratelimit/window';

export type RequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

export async function getRequestMeta(): Promise<RequestMeta> {
  const headerList = await headers();
  return {
    ipAddress: clientIpFrom(headerList),
    userAgent: headerList.get('user-agent'),
  };
}

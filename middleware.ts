/**
 * Edge route guard.
 *
 * This is a cheap first pass, not the security boundary. It checks only for the
 * *presence* of a session cookie so it can redirect an obviously-signed-out
 * visitor away from app routes and an obviously-signed-in one away from the
 * auth screens — without a database round trip on the edge. The real check
 * (validate the token, prove membership) happens server-side in the route
 * layouts via `getUserContext` / `getTenantContext`; a forged or expired cookie
 * gets past this guard and is rejected there.
 *
 * Kept dependency-light on purpose: it imports only a plain constant, so nothing
 * `server-only` or database-bound is dragged into the edge runtime.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME } from '@/config/constants';
import { SECURITY_HEADERS } from '@/config/security';

/** Reachable without a session. Everything else the matcher covers is protected. */
const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/signup',
  '/pricing',
  '/forgot-password',
  '/privacy',
  '/terms',
]);

/** Signing in again from these makes no sense — bounce to the app. */
const AUTH_PATHS = new Set(['/login', '/signup']);

/**
 * Prefixes that are public because the URL itself is the credential.
 *
 * An invitation link has to render for someone who has no account yet — that is
 * the whole point of it — so it cannot sit behind the session check. The page
 * reveals only the business name and the invited address, and accepting still
 * requires a signed-in account whose email matches.
 */
const PUBLIC_PREFIXES = ['/invite/'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const { key, value } of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

  if (hasSession && AUTH_PATHS.has(pathname)) {
    // …unless they are mid-invitation, where the sign-in screen is a step in the
    // flow rather than a dead end, and bouncing them would drop the token.
    if (request.nextUrl.searchParams.has('invite')) {
      return applySecurityHeaders(NextResponse.next());
    }
    return applySecurityHeaders(NextResponse.redirect(new URL('/dashboard', request.url)));
  }

  if (!hasSession && !isPublic(pathname)) {
    return applySecurityHeaders(NextResponse.redirect(new URL('/login', request.url)));
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  // Runs on page navigations only: skip API routes (webhooks must never be
  // redirected), Next internals, and anything with a file extension.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};

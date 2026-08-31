import { describe, expect, it } from 'vitest';
import {
  CONTENT_SECURITY_POLICY,
  CSP_DIRECTIVES,
  SECURITY_HEADERS,
} from '@/config/security';

describe('Phase 9 Unit 1: Security Headers & CSP Configuration', () => {
  it('defines all required Content Security Policy directives', () => {
    expect(CONTENT_SECURITY_POLICY).toBeDefined();
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("form-action 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain('upgrade-insecure-requests');
  });

  it('includes script-src, style-src, img-src, font-src, and connect-src', () => {
    expect(CSP_DIRECTIVES).toContain("default-src 'self'");
    expect(CSP_DIRECTIVES).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(CSP_DIRECTIVES).toContain("style-src 'self' 'unsafe-inline'");
    expect(CSP_DIRECTIVES).toContain("img-src 'self' data: https: blob:");
    expect(CSP_DIRECTIVES).toContain("font-src 'self' data:");
    expect(CSP_DIRECTIVES).toContain("connect-src 'self' https: wss:");
  });

  it('includes complete defense-in-depth security headers', () => {
    const headersMap = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));

    expect(headersMap.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(headersMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headersMap.get('X-Frame-Options')).toBe('DENY');
    expect(headersMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headersMap.get('X-DNS-Prefetch-Control')).toBe('off');
    expect(headersMap.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
    expect(headersMap.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headersMap.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(headersMap.get('Permissions-Policy')).toContain('camera=()');
    expect(headersMap.get('Permissions-Policy')).toContain('microphone=()');
    expect(headersMap.get('Permissions-Policy')).toContain('geolocation=()');
    expect(headersMap.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(headersMap.get('Strict-Transport-Security')).toContain('includeSubDomains');
  });
});

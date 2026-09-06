/**
 * The management half of the Meta integration: acquiring a token, proving a subscription,
 * and putting a number on Cloud API.
 *
 * These are the calls that decide whether a business's customers can reach them at all, and
 * three of the assertions here exist because getting them wrong is silent. A subscription
 * that was requested but never confirmed produces a green connection with an empty inbox. A
 * number Meta already registered, read as a failure, aborts an onboarding that succeeded. And
 * a state token that is accepted across workspaces lets one business's authorization code
 * connect somebody else's number.
 *
 * Real `Response` objects throughout — the client reads `headers`, `status` and `text()`, so a
 * duck-typed literal would pass while the production path failed on a header lookup.
 */

import { describe, expect, it, vi } from 'vitest';

import { env } from '@/config/env';
import { ProviderError, RateLimitError, ValidationError } from '@/server/errors';
import { MetaGraphClient } from '@/server/services/whatsapp/meta-graph.client';
import {
  createSignupState,
  signupStateMatchesActor,
  verifySignupState,
} from '@/server/services/whatsapp/meta-signup-state';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function clientWith(fetchFn: ReturnType<typeof vi.fn>): MetaGraphClient {
  return new MetaGraphClient({ fetchFn: fetchFn as unknown as typeof fetch });
}

const TOKEN = 'EAAG_business_integration_token_1234567890';

describe('Embedded Signup token exchange', () => {
  it('exchanges the code server-side and reports Meta’s expiry', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: TOKEN, token_type: 'bearer', expires_in: 5_184_000 }));

    const before = Date.now();
    const result = await clientWith(fetchFn).exchangeCodeForToken({ code: 'AQD_short_lived_code' });

    expect(result.accessToken).toBe(TOKEN);
    expect(result.expiresAt).not.toBeNull();
    expect(result.expiresAt!.getTime()).toBeGreaterThan(before);

    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/oauth/access_token');
    expect(url).toContain(`client_id=${env.META_APP_ID}`);
    expect(url).toContain('code=AQD_short_lived_code');
    // Codes minted by the browser SDK carry no redirect_uri, and sending one Meta did not
    // issue the code against fails the exchange — so an unset variable must omit the param.
    expect(url).not.toContain('redirect_uri');
  });

  it('reports a System User token’s absent expiry as null rather than as now', async () => {
    // `expires_in: 0` is Meta's "never expires". Reading it as an elapsed duration would put
    // the expiry in the past and have the health check declare a working token dead.
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ access_token: TOKEN, expires_in: 0 }));

    const result = await clientWith(fetchFn).exchangeCodeForToken({ code: 'code_value' });

    expect(result.expiresAt).toBeNull();
  });

  it('never echoes the authorization code back in an error, even when Meta does', async () => {
    const code = 'AQD_code_that_meta_reflects_back_0001';
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        { error: { message: `Invalid verification code format: ${code}`, code: 100 } },
        { status: 400 },
      ),
    );

    const error = await clientWith(fetchFn)
      .exchangeCodeForToken({ code })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect(String(error)).not.toContain(code);
    expect(String(error)).toContain('[REDACTED]');
  });

  it('never echoes the app secret back in an error', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        { error: { message: `Bad client_secret ${env.META_APP_SECRET}`, code: 101 } },
        { status: 400 },
      ),
    );

    const error = await clientWith(fetchFn)
      .exchangeCodeForToken({ code: 'code_value' })
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain(env.META_APP_SECRET);
  });

  it('refuses a 200 that carries no token instead of storing an empty credential', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ token_type: 'bearer' }));

    await expect(
      clientWith(fetchFn).exchangeCodeForToken({ code: 'code_value' }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('Token introspection', () => {
  it('collects the WABAs a token actually grants from Meta’s granular scopes', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: {
          app_id: env.META_APP_ID,
          is_valid: true,
          expires_at: 0,
          scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
          granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: ['109876543210987'] },
            { scope: 'whatsapp_business_messaging', target_ids: ['109876543210987'] },
            { scope: 'pages_show_list', target_ids: ['irrelevant'] },
          ],
        },
      }),
    );

    const result = await clientWith(fetchFn).debugToken(TOKEN);

    expect(result.isValid).toBe(true);
    expect(result.appId).toBe(env.META_APP_ID);
    // Deduplicated across the two WhatsApp scopes, and the unrelated scope is not collected.
    expect(result.grantedWabaIds).toEqual(['109876543210987']);
    expect(result.expiresAt).toBeNull();
  });

  it('does not send the inspected token as the caller’s own credential', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ data: { is_valid: true } }));

    await clientWith(fetchFn).debugToken(TOKEN);

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    // `input_token` is the subject; the app credential is what authorises the read.
    expect(url).toContain('input_token=');
    expect(url).toContain('access_token=');
    expect((init.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });
});

describe('Webhook subscription', () => {
  it('subscribes with a bearer token and no body', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ success: true }));

    await clientWith(fetchFn).subscribeAppToWaba({ wabaId: '109876543210987', accessToken: TOKEN });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/109876543210987/subscribed_apps');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('treats an explicit success:false as a refusal rather than as a subscription', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ success: false }));

    await expect(
      clientWith(fetchFn).subscribeAppToWaba({ wabaId: '109876543210987', accessToken: TOKEN }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('reads the edge back and reports which app id Meta lists', async () => {
    // This read is the only evidence that a customer message will be delivered here. A
    // `success: true` from the POST above is Meta accepting a request, not confirming state.
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            whatsapp_business_api_data: {
              id: env.META_APP_ID,
              name: 'ConvoNexa',
              link: 'https://convonexa.com',
            },
          },
        ],
      }),
    );

    const subscriptions = await clientWith(fetchFn).listWabaSubscriptions({
      wabaId: '109876543210987',
      accessToken: TOKEN,
    });

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.whatsappBusinessApiDataAppId).toBe(env.META_APP_ID);
    expect(subscriptions[0]?.appName).toBe('ConvoNexa');
  });

  it('reports an empty edge as an empty list, not as an error', async () => {
    // A WABA nobody is subscribed to is a real, recoverable state: the onboarding service
    // turns it into a DEGRADED connection with a reason, which a thrown error could not.
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [] }));

    const subscriptions = await clientWith(fetchFn).listWabaSubscriptions({
      wabaId: '109876543210987',
      accessToken: TOKEN,
    });

    expect(subscriptions).toEqual([]);
  });

  it('does not mistake another app’s subscription for our own', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [{ whatsapp_business_api_data: { id: '999999999999999', name: 'Another Tool' } }],
      }),
    );

    const subscriptions = await clientWith(fetchFn).listWabaSubscriptions({
      wabaId: '109876543210987',
      accessToken: TOKEN,
    });

    expect(
      subscriptions.some((entry) => entry.whatsappBusinessApiDataAppId === env.META_APP_ID),
    ).toBe(false);
  });
});

describe('Asset verification reads', () => {
  it('reads a WABA and normalises the owning business id', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: '109876543210987',
        name: 'Akmal Fashion',
        currency: 'PKR',
        timezone_id: '73',
        account_review_status: 'APPROVED',
        owner_business_info: { id: '2233445566778899', name: 'Akmal Fashion Pvt Ltd' },
      }),
    );

    const waba = await clientWith(fetchFn).getWaba({ wabaId: '109876543210987', accessToken: TOKEN });

    expect(waba.ownerBusinessId).toBe('2233445566778899');
    expect(waba.accountReviewStatus).toBe('APPROVED');
  });

  it('skips list entries with no id rather than persisting an unusable number', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: '106540352242922', display_phone_number: '+92 300 1234567', platform_type: 'CLOUD_API' },
          { display_phone_number: '+92 300 7654321' },
        ],
      }),
    );

    const numbers = await clientWith(fetchFn).listWabaPhoneNumbers({
      wabaId: '109876543210987',
      accessToken: TOKEN,
    });

    expect(numbers).toHaveLength(1);
    expect(numbers[0]?.id).toBe('106540352242922');
  });

  it('surfaces a rate limit with Meta’s own Retry-After', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Too many calls', code: 4 } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '90' },
      }),
    );

    const error = await clientWith(fetchFn)
      .getWaba({ wabaId: '109876543210987', accessToken: TOKEN })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBe(90);
  });
});

describe('Phone number registration', () => {
  it('sends the messaging product and the PIN, and reports a fresh registration', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({ success: true }));

    const outcome = await clientWith(fetchFn).registerPhoneNumber({
      phoneNumberId: '106540352242922',
      accessToken: TOKEN,
      pin: '482913',
    });

    expect(outcome).toEqual({ registered: true, alreadyRegistered: false });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/106540352242922/register');
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      pin: '482913',
    });
  });

  it('treats an already-registered number as success, by message', async () => {
    // Aborting here would fail an onboarding that had in fact succeeded — the number can
    // send, which is the only thing registration was for.
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        { error: { message: 'Phone number is already registered.', code: 100 } },
        { status: 400 },
      ),
    );

    const outcome = await clientWith(fetchFn).registerPhoneNumber({
      phoneNumberId: '106540352242922',
      accessToken: TOKEN,
      pin: '482913',
    });

    expect(outcome).toEqual({ registered: true, alreadyRegistered: true });
  });

  it('treats an already-registered number as success, by Meta subcode', async () => {
    // Both readings are checked because the subcode is not documented as stable and the
    // message wording is Meta's to change.
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        { error: { message: 'Cannot complete request', code: 500, error_subcode: 2_388_010 } },
        { status: 500 },
      ),
    );

    const outcome = await clientWith(fetchFn).registerPhoneNumber({
      phoneNumberId: '106540352242922',
      accessToken: TOKEN,
      pin: '482913',
    });

    expect(outcome.alreadyRegistered).toBe(true);
  });

  it('does not swallow the exhausted-attempts failure as success', async () => {
    // Ten registration calls per number per 72 hours. Reporting 133016 as registered would
    // leave a business believing replies work when the number is not on Cloud API.
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        { error: { message: 'Too many registration attempts', code: 133_016 } },
        { status: 400 },
      ),
    );

    await expect(
      clientWith(fetchFn).registerPhoneNumber({
        phoneNumberId: '106540352242922',
        accessToken: TOKEN,
        pin: '482913',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('never echoes the registration PIN back in an error', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Invalid pin 4829130000', code: 100 } }, { status: 400 }),
    );

    const error = await clientWith(fetchFn)
      .registerPhoneNumber({
        phoneNumberId: '106540352242922',
        accessToken: TOKEN,
        pin: '4829130000',
      })
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain('4829130000');
  });
});

describe('Embedded Signup state token', () => {
  const actor = { workspaceId: 'ws_akmal_fashion', membershipId: 'mem_owner_1' };

  it('round-trips the workspace and membership that started the flow', () => {
    const claims = verifySignupState(createSignupState(actor));

    expect(claims?.workspaceId).toBe(actor.workspaceId);
    expect(claims?.membershipId).toBe(actor.membershipId);
    expect(signupStateMatchesActor(claims, actor)).toBe(true);
  });

  it('carries no credential — the payload is signed, not secret', () => {
    const token = createSignupState(actor);
    const [, payload] = token.split('.');

    expect(Buffer.from(payload!, 'base64url').toString('utf8')).not.toContain(env.AUTH_SECRET);
  });

  it('refuses a payload edited after signing', () => {
    const token = createSignupState(actor);
    const [version, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ w: 'ws_someone_else', m: actor.membershipId, n: 'n', e: 9_999_999_999 }),
      'utf8',
    ).toString('base64url');

    expect(verifySignupState(`${version}.${forged}.${signature}`)).toBeNull();
  });

  it('refuses a token that is structurally wrong', () => {
    expect(verifySignupState('')).toBeNull();
    expect(verifySignupState('not-a-token')).toBeNull();
    expect(verifySignupState('v1.only-two-parts')).toBeNull();
    expect(verifySignupState(`v2.${createSignupState(actor).split('.').slice(1).join('.')}`)).toBeNull();
  });

  it('expires', () => {
    const issued = new Date('2026-09-06T10:00:00.000Z');
    const token = createSignupState({ ...actor, now: issued });

    expect(verifySignupState(token, new Date('2026-09-06T10:14:00.000Z'))).not.toBeNull();
    expect(verifySignupState(token, new Date('2026-09-06T10:16:00.000Z'))).toBeNull();
  });

  it('does not let a valid state from one workspace complete a signup in another', () => {
    // The attack this closes: a code obtained in one tenant, posted into another. The
    // signature proves only that we issued the token; the actor comparison is what proves it
    // was issued to the person now presenting it.
    const claims = verifySignupState(createSignupState(actor));

    expect(signupStateMatchesActor(claims, { ...actor, workspaceId: 'ws_other_shop' })).toBe(false);
  });

  it('does not let a different member of the same workspace complete someone else’s signup', () => {
    const claims = verifySignupState(createSignupState(actor));

    expect(signupStateMatchesActor(claims, { ...actor, membershipId: 'mem_admin_2' })).toBe(false);
  });

  it('treats an unusable token as a non-match rather than throwing', () => {
    expect(signupStateMatchesActor(null, actor)).toBe(false);
  });

  it('never issues the same token twice', () => {
    expect(createSignupState(actor)).not.toBe(createSignupState(actor));
  });
});

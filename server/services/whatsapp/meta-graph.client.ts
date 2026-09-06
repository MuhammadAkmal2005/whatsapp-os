/**
 * Meta Graph API client for *management* calls.
 *
 * Deliberately separate from `WhatsAppProvider`. That interface is the messaging
 * boundary — send text, send media, send a template, mark read — and it is
 * implemented twice, once against Meta and once as a mock the whole product runs on
 * offline. Onboarding calls are a different shape: they are made once during a
 * connection flow, they act on a WhatsApp Business Account rather than a phone
 * number, and several of them are not addressed by any phone number at all. Folding
 * `subscribeAppToWaba` into the provider interface would force the mock to implement
 * a management surface it has no business having.
 *
 * Every endpoint here was read from Meta's current documentation rather than
 * recalled. The ones that could *not* be verified — per-WABA webhook overrides — are
 * absent, and documented as absent in `docs/META_INTEGRATION.md`. A plausible
 * endpoint that does not exist is worse than an honest gap.
 *
 * Two invariants hold throughout:
 *
 *  1. No access token, app secret, or authorization code is ever logged, returned in
 *     an error message, or included in a thrown error's details. `redact` runs over
 *     every upstream message before it can reach a log line or a response.
 *  2. Every request carries an abort timeout. An onboarding flow runs inside a user's
 *     request, and a Graph call that hangs would hold that request open until the
 *     platform's own timeout killed it, which looks to the business owner like the
 *     product is broken rather than slow.
 */

import 'server-only';

import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { ProviderError, RateLimitError, ValidationError } from '@/server/errors';
import {
  isMetaGraphFailure,
  transportFailure,
  type MetaGraphFailure,
} from './meta-failure';

/** Graph calls made during onboarding run inside a user request. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Registration and subscription can be slower than a read. */
const MUTATION_TIMEOUT_MS = 25_000;

export type MetaGraphClientConfig = {
  /** Defaults to `env.WHATSAPP_API_VERSION` so a code exchange and a send agree. */
  apiVersion?: string;
  baseUrl?: string;
  /** Test seam. Production passes nothing and gets global `fetch`. */
  fetchFn?: typeof fetch;
};

export type MetaTokenExchangeResult = {
  accessToken: string;
  tokenType: string;
  /** Null when Meta returns no expiry, which is the case for System User tokens. */
  expiresAt: Date | null;
};

export type MetaTokenDebugResult = {
  appId: string | null;
  isValid: boolean;
  expiresAt: Date | null;
  scopes: readonly string[];
  /** Business/WABA ids the token actually grants, when Meta reports them. */
  grantedWabaIds: readonly string[];
};

export type MetaWabaSummary = {
  id: string;
  name: string | null;
  currency: string | null;
  timezoneId: string | null;
  /** Meta's own account review verdict: APPROVED, PENDING, REJECTED. */
  accountReviewStatus: string | null;
  ownerBusinessId: string | null;
};

export type MetaPhoneNumberSummary = {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
  throughputLevel: string | null;
};

export type MetaSubscriptionSummary = {
  /** The Meta app id subscribed to this WABA. */
  whatsappBusinessApiDataAppId: string | null;
  appName: string | null;
};

// ── Wire shapes ────────────────────────────────────────────────────────────
// Named for what Meta returns, not for what we would have called it, so a diff
// against the documentation is a straight read.

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

type OAuthTokenBody = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type DebugTokenBody = {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    expires_at?: number;
    data_access_expires_at?: number;
    scopes?: string[];
    granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
  };
};

type WabaBody = {
  id?: string;
  name?: string;
  currency?: string;
  timezone_id?: string;
  account_review_status?: string;
  owner_business_info?: { id?: string; name?: string };
};

type PhoneNumberBody = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  platform_type?: string;
  throughput?: { level?: string };
};

type PhoneNumberListBody = { data?: PhoneNumberBody[] };

type SubscribedAppsBody = {
  data?: Array<{
    whatsapp_business_api_data?: { id?: string; name?: string; link?: string };
  }>;
};

type SuccessBody = { success?: boolean };

/**
 * Strips every known secret out of a string before it can be logged or returned.
 *
 * Meta reflects request parameters back in some error messages, so an invalid code
 * exchange can echo the client secret. Splitting on each secret is exhaustive in a way
 * that a pattern match over "things that look like tokens" is not.
 */
function redact(message: string, secrets: readonly (string | undefined)[]): string {
  let output = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      output = output.split(secret).join('[REDACTED]');
    }
  }
  // Belt and braces: Meta access tokens are long and start with a known prefix, and a
  // token we were never given (a customer's, echoed by Meta) would survive the loop.
  return output.replace(/EAA[A-Za-z0-9_-]{20,}/g, '[REDACTED]');
}

export class MetaGraphClient {
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: MetaGraphClientConfig = {}) {
    this.apiVersion = config.apiVersion ?? env.WHATSAPP_API_VERSION;
    this.baseUrl = config.baseUrl ?? 'https://graph.facebook.com';
    this.fetchFn = config.fetchFn ?? fetch;
  }

  private url(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`${this.baseUrl}/${this.apiVersion}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /**
   * One request, one place where failures become typed errors.
   *
   * `secrets` is the list of values that must never appear in a thrown message. It is
   * passed per call rather than held on the instance because the token varies by
   * tenant while the app secret does not.
   */
  private async request<T>(options: {
    method: 'GET' | 'POST' | 'DELETE';
    url: string;
    accessToken?: string;
    body?: Record<string, unknown>;
    timeoutMs?: number;
    secrets?: readonly (string | undefined)[];
    /** For log lines. Never includes ids that are secret, because none are. */
    operation: string;
  }): Promise<T> {
    const secrets = [...(options.secrets ?? []), options.accessToken, env.META_APP_SECRET];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetchFn(options.url, {
        method: options.method,
        headers: {
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
    } catch (transportError) {
      const failure = transportFailure(transportError);
      logger.error('meta.graph.transport_failed', {
        operation: options.operation,
        transportCode: failure.transportCode,
        requestPossiblySent: failure.requestPossiblySent,
      });
      throw new ProviderError(
        'whatsapp',
        `Could not reach Meta (${failure.transportCode ?? 'network error'}).`,
        failure,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      await this.throwForResponse(response, options.operation, secrets);
    }

    // A 2xx with an empty body is a real case on DELETE edges. Treat empty as an
    // empty object rather than failing a call that actually succeeded.
    const text = await response.text();
    if (text.trim().length === 0) return {} as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      logger.error('meta.graph.malformed_response', {
        operation: options.operation,
        status: response.status,
      });
      const failure: MetaGraphFailure = {
        kind: 'malformed',
        status: response.status,
        metaCode: null,
        metaSubcode: null,
        requestPossiblySent: true,
        transportCode: null,
      };
      throw new ProviderError('whatsapp', 'Meta returned a response we could not read.', failure);
    }
  }

  private async throwForResponse(
    response: Response,
    operation: string,
    secrets: readonly (string | undefined)[],
  ): Promise<never> {
    let body: GraphErrorBody | null = null;
    try {
      body = (await response.json()) as GraphErrorBody;
    } catch {
      // Not JSON. The status alone carries the information.
    }

    const metaCode = body?.error?.code ?? null;
    const metaSubcode = body?.error?.error_subcode ?? null;
    const raw =
      body?.error?.error_user_msg ??
      body?.error?.message ??
      `HTTP ${response.status} ${response.statusText}`;
    const message = redact(raw, secrets);

    const failure: MetaGraphFailure = {
      kind: 'http',
      status: response.status,
      metaCode,
      metaSubcode,
      // Meta received it. Whether it acted on it is exactly what we cannot know.
      requestPossiblySent: response.status >= 500,
      transportCode: null,
    };

    logger.warn('meta.graph.request_failed', {
      operation,
      status: response.status,
      metaCode,
      metaSubcode,
      fbtraceId: body?.error?.fbtrace_id ?? null,
    });

    if (response.status === 429 || metaCode === 4 || metaCode === 80007) {
      const header = response.headers.get('Retry-After');
      const parsed = header ? Number.parseInt(header, 10) : Number.NaN;
      throw new RateLimitError(Number.isNaN(parsed) ? 60 : parsed, `Meta rate limit: ${message}`);
    }

    if (response.status === 401 || response.status === 403 || metaCode === 190 || metaCode === 10) {
      throw new ProviderError('whatsapp', `Meta rejected our credentials: ${message}`, failure);
    }

    if (response.status === 400 || response.status === 422 || metaCode === 100) {
      throw new ValidationError(`Meta rejected the request: ${message}`);
    }

    throw new ProviderError('whatsapp', `Meta API error: ${message}`, failure);
  }

  // ── Token acquisition ────────────────────────────────────────────────────

  /**
   * Exchanges an Embedded Signup authorization code for a business integration
   * system user access token.
   *
   * `GET /{version}/oauth/access_token?client_id&client_secret&code[&redirect_uri]`
   *
   * The code is single-use and expires roughly 30 seconds after the dialog closes, so
   * this runs immediately in the callback rather than being queued. `redirect_uri` is
   * sent only when configured: codes minted by the browser SDK carry none, and
   * supplying one Meta did not issue the code against fails the exchange.
   *
   * The returned token is the customer's, scoped to the assets they granted. It goes
   * straight into `encryptSecret` and is never returned past the service layer.
   */
  async exchangeCodeForToken(params: {
    code: string;
    redirectUri?: string;
  }): Promise<MetaTokenExchangeResult> {
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw new ValidationError('Meta app credentials are not configured on this deployment.');
    }

    const body = await this.request<OAuthTokenBody>({
      method: 'GET',
      operation: 'oauth.exchange_code',
      url: this.url('oauth/access_token', {
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        code: params.code,
        redirect_uri: params.redirectUri,
      }),
      // The code is a credential in its own right: anyone holding it can mint the
      // customer's token until it expires.
      secrets: [params.code],
    });

    if (!body.access_token) {
      throw new ProviderError('whatsapp', 'Meta returned no access token for this code.');
    }

    return {
      accessToken: body.access_token,
      tokenType: body.token_type ?? 'bearer',
      expiresAt:
        typeof body.expires_in === 'number' && body.expires_in > 0
          ? new Date(Date.now() + body.expires_in * 1000)
          : null,
    };
  }

  /**
   * Inspects a token: is it valid, when does it expire, and what does it grant.
   *
   * `GET /debug_token?input_token=<token>&access_token=<app_id>|<app_secret>`
   *
   * Used at connect time to confirm the token really belongs to our app — a token
   * issued to some other app would otherwise work for reads and fail confusingly
   * later — and by the health checker to warn before an expiry rather than after.
   *
   * Note `debug_token` is unversioned in Meta's own examples; it is called on the
   * versioned path here for consistency, which Meta accepts.
   */
  async debugToken(accessToken: string): Promise<MetaTokenDebugResult> {
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw new ValidationError('Meta app credentials are not configured on this deployment.');
    }

    const body = await this.request<DebugTokenBody>({
      method: 'GET',
      operation: 'oauth.debug_token',
      url: this.url('debug_token', {
        input_token: accessToken,
        access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}`,
      }),
      secrets: [accessToken],
    });

    const data = body.data ?? {};
    const grantedWabaIds = new Set<string>();
    for (const grant of data.granular_scopes ?? []) {
      if (grant.scope === 'whatsapp_business_management' || grant.scope === 'whatsapp_business_messaging') {
        for (const id of grant.target_ids ?? []) grantedWabaIds.add(id);
      }
    }

    return {
      appId: data.app_id ?? null,
      isValid: data.is_valid === true,
      // Meta reports 0 for "never expires" rather than omitting the field.
      expiresAt:
        typeof data.expires_at === 'number' && data.expires_at > 0
          ? new Date(data.expires_at * 1000)
          : null,
      scopes: data.scopes ?? [],
      grantedWabaIds: [...grantedWabaIds],
    };
  }

  // ── Webhook subscription ─────────────────────────────────────────────────

  /**
   * Subscribes ConvoNexa's app to a WhatsApp Business Account's webhooks.
   *
   * `POST /<WABA_ID>/subscribed_apps` — bearer token only, no body.
   *
   * This is the call that was missing entirely before this integration existed, and
   * the reason a "connected" account could receive nothing. A configured callback URL
   * in the app dashboard tells Meta *where* to deliver; this tells Meta *which
   * accounts* to deliver. Without it the webhook is silent and everything else looks
   * fine.
   */
  async subscribeAppToWaba(params: { wabaId: string; accessToken: string }): Promise<void> {
    const body = await this.request<SuccessBody>({
      method: 'POST',
      operation: 'waba.subscribe',
      url: this.url(`${encodeURIComponent(params.wabaId)}/subscribed_apps`),
      accessToken: params.accessToken,
      timeoutMs: MUTATION_TIMEOUT_MS,
    });

    if (body.success === false) {
      throw new ProviderError('whatsapp', 'Meta declined the webhook subscription for this account.');
    }
  }

  /**
   * Which apps are subscribed to this WABA right now.
   *
   * `GET /<WABA_ID>/subscribed_apps`
   *
   * The health check calls this rather than trusting `subscribedAt`. A business that
   * revokes permissions in Business Manager removes the subscription without telling
   * us, and "we subscribed once" is not the same fact as "it is subscribed now".
   */
  async listWabaSubscriptions(params: {
    wabaId: string;
    accessToken: string;
  }): Promise<readonly MetaSubscriptionSummary[]> {
    const body = await this.request<SubscribedAppsBody>({
      method: 'GET',
      operation: 'waba.list_subscriptions',
      url: this.url(`${encodeURIComponent(params.wabaId)}/subscribed_apps`),
      accessToken: params.accessToken,
    });

    return (body.data ?? []).map((entry) => ({
      whatsappBusinessApiDataAppId: entry.whatsapp_business_api_data?.id ?? null,
      appName: entry.whatsapp_business_api_data?.name ?? null,
    }));
  }

  /** `DELETE /<WABA_ID>/subscribed_apps`. Called on disconnect so Meta stops sending. */
  async unsubscribeAppFromWaba(params: { wabaId: string; accessToken: string }): Promise<void> {
    await this.request<SuccessBody>({
      method: 'DELETE',
      operation: 'waba.unsubscribe',
      url: this.url(`${encodeURIComponent(params.wabaId)}/subscribed_apps`),
      accessToken: params.accessToken,
      timeoutMs: MUTATION_TIMEOUT_MS,
    });
  }

  // ── Asset reads ──────────────────────────────────────────────────────────

  /**
   * Reads a WABA. Used to prove server-side that the token actually grants the
   * account id the client claimed, before a single row is written.
   */
  async getWaba(params: { wabaId: string; accessToken: string }): Promise<MetaWabaSummary> {
    const body = await this.request<WabaBody>({
      method: 'GET',
      operation: 'waba.get',
      url: this.url(encodeURIComponent(params.wabaId), {
        fields: 'id,name,currency,timezone_id,account_review_status,owner_business_info',
      }),
      accessToken: params.accessToken,
    });

    if (!body.id) {
      throw new ProviderError('whatsapp', 'Meta returned no WhatsApp Business Account for that id.');
    }

    return {
      id: body.id,
      name: body.name ?? null,
      currency: body.currency ?? null,
      timezoneId: body.timezone_id ?? null,
      accountReviewStatus: body.account_review_status ?? null,
      ownerBusinessId: body.owner_business_info?.id ?? null,
    };
  }

  /** `GET /<WABA_ID>/phone_numbers`. The authoritative list of what we may send from. */
  async listWabaPhoneNumbers(params: {
    wabaId: string;
    accessToken: string;
  }): Promise<readonly MetaPhoneNumberSummary[]> {
    const body = await this.request<PhoneNumberListBody>({
      method: 'GET',
      operation: 'waba.list_phone_numbers',
      url: this.url(`${encodeURIComponent(params.wabaId)}/phone_numbers`, {
        fields:
          'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput',
      }),
      accessToken: params.accessToken,
    });

    return (body.data ?? [])
      .filter((entry): entry is PhoneNumberBody & { id: string } => typeof entry.id === 'string')
      .map((entry) => this.toPhoneSummary(entry));
  }

  /** One phone number. Also the cheapest proof that a token is still live. */
  async getPhoneNumber(params: {
    phoneNumberId: string;
    accessToken: string;
  }): Promise<MetaPhoneNumberSummary> {
    const body = await this.request<PhoneNumberBody>({
      method: 'GET',
      operation: 'phone_number.get',
      url: this.url(encodeURIComponent(params.phoneNumberId), {
        fields:
          'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput',
      }),
      accessToken: params.accessToken,
    });

    if (!body.id) {
      throw new ProviderError('whatsapp', 'Meta returned no phone number for that id.');
    }

    return this.toPhoneSummary(body as PhoneNumberBody & { id: string });
  }

  private toPhoneSummary(entry: PhoneNumberBody & { id: string }): MetaPhoneNumberSummary {
    return {
      id: entry.id,
      displayPhoneNumber: entry.display_phone_number ?? '',
      verifiedName: entry.verified_name ?? null,
      qualityRating: entry.quality_rating ?? null,
      codeVerificationStatus: entry.code_verification_status ?? null,
      platformType: entry.platform_type ?? null,
      throughputLevel: entry.throughput?.level ?? null,
    };
  }

  // ── Phone number registration ────────────────────────────────────────────

  /**
   * Registers a phone number for Cloud API messaging.
   *
   * `POST /<PHONE_NUMBER_ID>/register` with `{messaging_product, pin}`.
   *
   * An unregistered number cannot send, however valid the token is, which is one of
   * the two ways a connection can look healthy and be useless. Meta allows 10
   * registration attempts per number per 72 hours (error 133016 when exhausted), so
   * this is called once during onboarding and never on a retry loop.
   *
   * Returns `true` when this call registered the number and `false` when Meta says it
   * was already registered — which is success, not failure, and must not surface to a
   * business owner as an error.
   */
  async registerPhoneNumber(params: {
    phoneNumberId: string;
    accessToken: string;
    pin: string;
    dataLocalizationRegion?: string;
  }): Promise<{ registered: boolean; alreadyRegistered: boolean }> {
    try {
      const body = await this.request<SuccessBody>({
        method: 'POST',
        operation: 'phone_number.register',
        url: this.url(`${encodeURIComponent(params.phoneNumberId)}/register`),
        accessToken: params.accessToken,
        body: {
          messaging_product: 'whatsapp',
          pin: params.pin,
          ...(params.dataLocalizationRegion
            ? { data_localization_region: params.dataLocalizationRegion }
            : {}),
        },
        timeoutMs: MUTATION_TIMEOUT_MS,
        // The PIN is a credential for this number's two-step verification.
        secrets: [params.pin],
      });

      return { registered: body.success !== false, alreadyRegistered: false };
    } catch (error) {
      if (isAlreadyRegistered(error)) {
        logger.info('meta.graph.phone_already_registered', {
          phoneNumberId: params.phoneNumberId,
        });
        return { registered: true, alreadyRegistered: true };
      }
      throw error;
    }
  }

  /** `POST /<PHONE_NUMBER_ID>/deregister`. Best-effort on disconnect. */
  async deregisterPhoneNumber(params: {
    phoneNumberId: string;
    accessToken: string;
  }): Promise<void> {
    await this.request<SuccessBody>({
      method: 'POST',
      operation: 'phone_number.deregister',
      url: this.url(`${encodeURIComponent(params.phoneNumberId)}/deregister`),
      accessToken: params.accessToken,
      body: { messaging_product: 'whatsapp' },
      timeoutMs: MUTATION_TIMEOUT_MS,
    });
  }
}

/**
 * Meta reports an already-registered number as a 400 with code 100 and subcode
 * 2388010, or with a message naming the condition. Both readings are checked because
 * the subcode is not documented as stable, and treating "already registered" as a
 * failure would abort an onboarding that had in fact succeeded.
 */
function isAlreadyRegistered(error: unknown): boolean {
  if (error instanceof ValidationError) {
    return /already\s+registered/i.test(error.message);
  }
  if (error instanceof ProviderError && isMetaGraphFailure(error.cause)) {
    return error.cause.metaSubcode === 2_388_010;
  }
  return false;
}

/**
 * The default client.
 *
 * A module-level instance rather than a per-call construction: it holds no
 * credentials, only the API version and base URL, so sharing it is safe and avoids
 * re-reading configuration on every onboarding step. Tests construct their own with a
 * `fetchFn`.
 */
export const metaGraphClient = new MetaGraphClient();



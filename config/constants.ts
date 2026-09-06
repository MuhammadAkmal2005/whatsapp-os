/**
 * Values that would otherwise be magic numbers scattered through the codebase.
 * Anything here has a name that explains the choice, and a comment where the
 * choice is not self-evident.
 *
 * Deliberately dependency-free so it can be imported from anywhere, including
 * pure unit tests that run without a database or a bundler.
 */

// ── Product identity ─────────────────────────────────────────────────────────
/**
 * The working name lives here, not scattered through the UI, because the master
 * brief says the name may change and the codebase must not be coupled to it.
 * Swap these two values and the product is renamed everywhere.
 */
export const APP_NAME = 'ConvoNexa';
export const APP_TAGLINE = 'AI-powered conversations that grow your business';

// ── Money ──────────────────────────────────────────────────────────────────
/** Minor units per major unit. 100 paisa to the rupee, 100 cents to the dollar. */
export const MINOR_UNITS_PER_MAJOR = 100;

/** Basis points in 100%. Tax rates are stored in bps to keep the maths integral. */
export const BASIS_POINTS_DIVISOR = 10_000;

export const SUPPORTED_CURRENCIES = ['PKR', 'USD', 'AED', 'GBP', 'EUR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'PKR';

// ── Sessions and tokens ────────────────────────────────────────────────────
export const SESSION_COOKIE_NAME = 'wos_session';
export const ACTIVE_WORKSPACE_COOKIE_NAME = 'wos_workspace';

/** 32 bytes of CSPRNG output. 256 bits is far past any brute-force concern. */
export const SESSION_TOKEN_BYTES = 32;

/**
 * A session is slid forward when less than half its life remains. Renewing on
 * every request would write to the database on every page view; renewing only
 * at expiry would log active users out mid-task.
 */
export const SESSION_RENEWAL_THRESHOLD = 0.5;

export const INVITE_TOKEN_BYTES = 32;
export const INVITE_EXPIRY_HOURS = 168; // one week
export const PASSWORD_RESET_EXPIRY_MINUTES = 60;
export const EMAIL_VERIFICATION_EXPIRY_HOURS = 48;

// ── Passwords ──────────────────────────────────────────────────────────────
/**
 * Twelve characters with no composition rules. Length dominates entropy, and
 * composition rules mostly produce "Password1!" — they push users toward
 * predictable substitutions rather than longer secrets.
 */
export const PASSWORD_MIN_LENGTH = 12;
/**
 * Bounded to keep a hash from becoming a denial-of-service vector: scrypt cost
 * grows with input, and an unbounded field lets an attacker send a megabyte.
 */
export const PASSWORD_MAX_LENGTH = 256;

// ── Pagination ─────────────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** Messages are taller than table rows, so a thread page is smaller. */
export const MESSAGE_PAGE_SIZE = 40;

/**
 * How many active products the manual order builder loads into its picker at once.
 * The picker filters this set in the browser, so the cap keeps the initial payload
 * small; a shop past it searches by name to narrow the list. Well above a typical
 * clothing seller's live catalogue, so in practice the whole catalogue is offered.
 */
export const ORDER_BUILDER_CATALOGUE_LIMIT = 200;

// ── Rate limits ────────────────────────────────────────────────────────────
/**
 * Each entry is [max attempts, window in seconds]. Authentication limits are
 * deliberately tight; AI limits exist to stop a single workspace burning the
 * budget, not to inconvenience real use.
 */
export const RATE_LIMITS = {
  login: { limit: 8, windowSeconds: 300 },
  signup: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  /** Keyed per workspace. Generous enough to onboard a whole shop's staff in one
   *  sitting, tight enough that the invite endpoint cannot be used as a mailer to
   *  arbitrary addresses once email delivery is connected. */
  memberInvite: { limit: 20, windowSeconds: 3600 },
  aiRequestPerUser: { limit: 60, windowSeconds: 60 },
  aiRequestPerWorkspace: { limit: 300, windowSeconds: 60 },
  messageSend: { limit: 120, windowSeconds: 60 },
  /**
   * The transport ceiling, keyed per workspace — distinct from `messageSend`, which
   * bounds how fast a *human* can compose in the inbox.
   *
   * Every send reaches Meta through one dispatch path: human replies, AI replies,
   * automations, and campaigns. Without a bucket here, one workspace's campaign can
   * occupy every worker slot and delay another workspace's customer reply. Ten per
   * second sits far below Meta's default 80 messages/second per number, so we are never
   * the reason Meta returns a 429, and a denial defers rather than drops — the message
   * stays queued, and eight attempts of exponential backoff span roughly an hour, enough
   * for a several-thousand-recipient campaign to drain.
   */
  messageDispatch: { limit: 600, windowSeconds: 60 },
  fileUpload: { limit: 30, windowSeconds: 300 },
  publicApi: { limit: 100, windowSeconds: 60 },
  webhook: { limit: 2000, windowSeconds: 60 },
  /**
   * Rejected webhook deliveries only, keyed per source IP.
   *
   * The WhatsApp endpoint deliberately does *not* throttle deliveries that carry a valid
   * `X-Hub-Signature-256`: only Meta and this deployment hold the app secret, so a valid
   * signature is proof of origin, and dropping such a request loses a real customer
   * message and pushes Meta towards disabling the subscription. Meta also delivers every
   * tenant's traffic from a small pool of addresses, so an IP bucket in front of the
   * signature check is a tenant-starvation mechanism rather than a defence. What does
   * deserve bounding is a source sending signatures that do not verify.
   */
  webhookRejected: { limit: 60, windowSeconds: 60 },
} as const;

export type RateLimitKey = keyof typeof RATE_LIMITS;

// ── Conversations ──────────────────────────────────────────────────────────
/**
 * WhatsApp only permits free-form business-initiated replies within 24 hours of
 * the customer's last message. Outside it, a template is required. This is a
 * platform rule, not a preference.
 */
export const CUSTOMER_SERVICE_WINDOW_HOURS = 24;

/** A conversation with no activity for this long is considered abandoned. */
export const CONVERSATION_IDLE_HOURS = 24;

/**
 * Once a thread exceeds this many messages beyond the last summary, the rolling
 * summary is regenerated. Summarising on every turn would cost more than it
 * saves.
 */
export const SUMMARY_REFRESH_MESSAGE_COUNT = 20;

// ── AI ─────────────────────────────────────────────────────────────────────
export const MAX_TOOL_CALLS_PER_TURN = 5;

/**
 * Confidence bands. Derived from evidence — retrieval scores, tool success,
 * intent match — never from the model's own claim about itself.
 */
export const CONFIDENCE_HIGH_THRESHOLD = 0.7;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.45;

/** Rough characters-per-token for budgeting before a real tokeniser is wired in. */
export const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Knowledge retrieval, in one place.
 *
 * These four numbers used to be spread across three files: a `MAX_RETRIEVED_CHUNKS`
 * constant nothing imported, a `topK: 5` and `threshold: 0.6` written inline in the
 * runtime, and an `AI_RETRIEVAL_MIN_SCORE` environment variable nothing read. Three
 * sources of truth, two of them dead, and the live one invisible from configuration.
 *
 * `similarityFloor` is cosine *similarity*; the repository converts it to the
 * distance ceiling pgvector actually compares against. It is set where a chunk has
 * to be genuinely on-topic to be shown to the model: a loose floor is how an
 * assistant answers a question about refunds from a paragraph about delivery.
 */
export const KNOWLEDGE_RETRIEVAL = {
  /** Chunks a single turn may retrieve. */
  topK: 6,

  /** Cosine similarity a chunk must reach to count as evidence at all. */
  similarityFloor: 0.6,

  /**
   * Ceiling on the assembled evidence block, in tokens, converted through
   * `APPROX_CHARS_PER_TOKEN` at the point of use. Expressed in tokens because the
   * constraint being defended is the model's context window and the per-turn cost,
   * both of which are billed in tokens. Without a real cap, `topK` long chunks
   * silently become the largest part of every prompt.
   */
  evidenceTokenBudget: 1_200,

  /**
   * Characters any single chunk may contribute. Stops one long document from
   * consuming the whole budget and crowding out the other matches, which is worse
   * than truncating it — the top match is rarely the only relevant one.
   */
  maxCharsPerChunk: 1_200,
} as const;

// ── Knowledge ingestion ────────────────────────────────────────────────────
/**
 * How a knowledge document is cut into the pieces that get embedded.
 *
 * The unit is **characters** — JavaScript string length, i.e. UTF-16 code units — not
 * tokens. Tokens would be the theoretically better unit and are the wrong choice here:
 * the only accurate tokeniser for the embedding model is a network call, so a
 * token-exact chunker would make chunking non-deterministic, unavailable offline, and
 * untestable without a provider. Characters are deterministic, dependency-free, and
 * behave sanely across English, Urdu and Roman Urdu.
 *
 * `maxChars` is not written as a literal on purpose. It is the same quantity as
 * `KNOWLEDGE_RETRIEVAL.maxCharsPerChunk`, which is the point at which retrieval
 * *truncates* a chunk before showing it to the model. A chunker allowed to emit
 * something longer would be storing text that can never be retrieved whole, so the two
 * are wired to one value rather than kept equal by hand.
 */
export const KNOWLEDGE_CHUNKING = {
  /** What a chunk aims for. Roughly a long paragraph — big enough to carry a whole
   *  policy statement, small enough that six of them fit the evidence budget. */
  targetChars: 900,

  /** Carried from the end of one chunk into the start of the next, so a fact that
   *  straddles a boundary is still complete in one of them. */
  overlapChars: 150,

  /** Below this a chunk is a fragment: it is merged backwards rather than emitted,
   *  because a lone half-sentence retrieves badly and pollutes the evidence block. */
  minChars: 80,

  /** Hard ceiling. Equal to what retrieval will show, by construction. */
  maxChars: KNOWLEDGE_RETRIEVAL.maxCharsPerChunk,
} as const;

/**
 * Chunks embedded per provider request.
 *
 * The Gemini adapter sends whatever array it is handed as a single request with no
 * internal splitting, so batch sizing is entirely the caller's business. 32 keeps a
 * request comfortably inside provider payload limits while cutting the number of
 * round-trips for a 50,000-character document from hundreds to a handful. Batches run
 * sequentially: a document is not urgent enough to justify hammering the provider in
 * parallel and inviting a rate limit that fails the whole ingestion.
 */
export const KNOWLEDGE_EMBEDDING_BATCH_SIZE = 32;

/**
 * Bounds on what an owner may submit, enforced server-side.
 *
 * Both a character cap and a byte cap exist because they defend different things.
 * Characters bound the work: 50,000 is a long policy document and still chunks and
 * embeds inside one job. Bytes bound the storage and the transport, and they are not
 * derivable from the character count — Urdu costs two bytes per character in UTF-8 and
 * an emoji costs four, so a 50,000-character Urdu document is 100kB while an English
 * one is 50kB. Checking only characters would let a well-formed submission be four
 * times larger than intended.
 */
export const KNOWLEDGE_MAX_TITLE_CHARS = 200;
export const KNOWLEDGE_MAX_CONTENT_CHARS = 50_000;
export const KNOWLEDGE_MAX_CONTENT_BYTES = 200_000;
export const KNOWLEDGE_MAX_QUESTION_CHARS = 500;
export const KNOWLEDGE_MAX_ANSWER_CHARS = 5_000;

/**
 * Ceiling on the pieces one document may produce.
 *
 * Reachable only by pathological input — 50,000 characters at the 900-character target
 * is under 70 pieces — so hitting it means the text defeated every separator in the
 * ladder. It exists so that case fails as a named, permanent error instead of as
 * hundreds of embedding calls and a multi-megabyte insert.
 */
export const KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT = 400;

/**
 * How often the knowledge list re-reads itself while a document is being processed.
 *
 * Processing is a background job, so the row that says "Processing…" has no way to learn it
 * finished — and telling a shop owner to refresh the page to find out whether their return
 * policy saved is the kind of small indignity that makes software feel broken.
 *
 * Three seconds is chosen against the work being waited on: a short text document is chunked,
 * embedded and published in a few seconds, so a slower poll would usually show the result
 * long after it happened, and a faster one would spend requests to shave off a wait nobody
 * perceives. The poll only runs while something is actually in flight, and stops when the
 * last row settles.
 */
export const KNOWLEDGE_STATUS_POLL_MS = 3_000;

// ── Uploads ────────────────────────────────────────────────────────────────
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
] as const;

export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/amr',
] as const;

// ── Jobs ───────────────────────────────────────────────────────────────────
export const JOB_DEFAULT_MAX_ATTEMPTS = 5;
/** Base for exponential backoff: 5s, 25s, 125s, ... */
export const JOB_BACKOFF_BASE_SECONDS = 5;
export const JOB_LOCK_TIMEOUT_SECONDS = 300;
export const JOB_POLL_INTERVAL_MS = 2000;
export const JOB_BATCH_SIZE = 5;

/**
 * How long a knowledge document may claim to be processing before the list offers a way out.
 *
 * Declared here rather than beside `KNOWLEDGE_STATUS_POLL_MS` because it is derived from the
 * queue's lock timeout, and a `const` cannot reference one declared below it. The derivation
 * is the point: a worker that holds a job past `JOB_LOCK_TIMEOUT_SECONDS` is, by the queue's
 * own definition, no longer alive, so this is not a guess about how long processing "should"
 * take — it is the moment the queue stops believing in the worker.
 *
 * What it buys is an escape from the one state a shop owner cannot otherwise leave. A
 * document stuck on "Processing…" for ever is worse than a visible failure: there is nothing
 * to press, nothing to read, and no way to tell a slow job from a dead one. Past this point
 * the row says so and offers Try again.
 */
export const KNOWLEDGE_STALLED_AFTER_MS = JOB_LOCK_TIMEOUT_SECONDS * 1_000;

// ── Inventory ──────────────────────────────────────────────────────────────
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

// ── AI agent defaults ──────────────────────────────────────────────────────
/**
 * Every workspace gets one agent at signup, and these are the words it starts
 * with. A workspace with no agent row cannot answer anyone: the runtime resolves
 * the agent before it does anything else, and finding none ends the turn without
 * a reply — the job succeeds and the customer is left waiting, which is the worst
 * shape a failure can take.
 *
 * "AI Assistant" matches the onboarding copy above, so the thing the checklist
 * tells the owner to set up is the thing they find waiting for them.
 */
export const DEFAULT_AI_AGENT_NAME = 'AI Assistant';

/**
 * Roman Urdu mixed with English, because that is how the initial market actually
 * writes on WhatsApp and it matches the schema's default `languages` of English
 * and Roman Urdu. It promises only what the agent can genuinely do from the
 * business's own data — products, prices, delivery — and the owner can rewrite it.
 */
export const DEFAULT_AI_AGENT_GREETING =
  'Assalamualaikum! Kya poochna chahte hain? Main products, prices aur delivery ke baare mein bata sakta hoon.';

/**
 * The bounds the AI agent configuration form and its schema both hold to.
 *
 * Lengths are generous enough for real use and tight enough that no single field can
 * dominate the system prompt. The prompt is assembled from these values plus retrieved
 * evidence and a window of recent messages, and every token spent restating the persona
 * is a token not spent on the customer's actual question — so `persona` is a paragraph,
 * `customInstructions` is a page, and neither is unbounded.
 *
 * `temperature` stops at 1 even though the provider accepts more. This agent quotes
 * prices and stock from tool results; the value of sampling further out is nil and the
 * cost is a fluent answer that drifts from the evidence.
 *
 * `maxOutputTokens` mirrors the range `AI_MAX_OUTPUT_TOKENS` is validated against in
 * `config/env.ts`, because it is the same quantity decided one level down. Below 64 a
 * reply cannot finish a sentence about delivery; above 4,096 a WhatsApp message is an
 * essay nobody reads and the workspace pays for every token of it.
 *
 * `handoffKeywords` is capped at 20 because the runtime tests every keyword against
 * every inbound message, and a list longer than that is a sign the owner wants intent
 * detection rather than keywords.
 */
export const AGENT_CONFIG_LIMITS = {
  nameMax: 60,
  personaMax: 500,
  greetingMax: 1000,
  customInstructionsMax: 2000,
  temperatureMin: 0,
  temperatureMax: 1,
  maxOutputTokensMin: 64,
  maxOutputTokensMax: 4096,
  handoffKeywordsMax: 20,
  handoffKeywordMax: 40,
} as const;

// ── Onboarding ─────────────────────────────────────────────────────────────
/**
 * Ordered. The checklist renders in this sequence and the "next step" hint
 * picks the first incomplete one.
 */
export const ONBOARDING_STEPS = [
  'business_created',
  'business_profile',
  'whatsapp_connected',
  'ai_configured',
  'knowledge_added',
  'product_added',
  'ai_tested',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Shop-owner-facing copy for each step. Deliberately not "configure webhook" or
 * "ingest knowledge" — the language a person who knows WhatsApp but not software
 * would use.
 *
 * `href` names the step's real screen, spelled exactly as the navigation registries
 * spell it, so whether a step can be acted on today is derived from
 * `isNavDestinationAvailable` rather than from a second list that has to be kept in
 * step by hand. `action` is the button label: a checklist row whose button says
 * "Continue" makes the reader guess where it goes.
 */
export const ONBOARDING_STEP_META: Record<
  OnboardingStep,
  { title: string; description: string; href: string; action: string }
> = {
  business_created: {
    title: 'Create your business',
    description: 'Give your workspace a name to get started.',
    href: '/dashboard',
    action: 'Open dashboard',
  },
  business_profile: {
    title: 'Add your business details',
    description: 'Your hours, delivery charges and the basics customers ask about.',
    href: '/settings/business',
    action: 'Add details',
  },
  whatsapp_connected: {
    title: 'Connect WhatsApp',
    description: 'Link your WhatsApp Business number so messages arrive here.',
    href: '/settings/whatsapp',
    action: 'Connect WhatsApp',
  },
  ai_configured: {
    title: 'Set up your AI assistant',
    description: 'Give it a name, choose the job it does, and add your own instructions.',
    href: '/agent',
    action: 'Set up your AI',
  },
  knowledge_added: {
    title: 'Teach your AI about your business',
    description: 'Add FAQs, delivery and return policies so answers are accurate.',
    href: '/knowledge',
    action: 'Add knowledge',
  },
  product_added: {
    title: 'Add your first product',
    description: 'Prices and stock your assistant can quote from.',
    href: '/products',
    action: 'Add a product',
  },
  ai_tested: {
    title: 'Test your AI',
    description: 'Ask it a customer question and see how it answers before going live.',
    href: '/playground',
    action: 'Test your AI',
  },
};

// ── Business categories ──────────────────────────────────────────────────────
/**
 * Offered at onboarding to tailor copy and, later, defaults. Free text is still
 * accepted — this is a convenience list, not a closed set — so a business that
 * does not fit is never blocked.
 */
export const BUSINESS_CATEGORIES = [
  'Clothing & Fashion',
  'Online Store / E-commerce',
  'Beauty & Cosmetics',
  'Electronics & Gadgets',
  'Food & Restaurant',
  'Home & Living',
  'Health & Fitness',
  'Salon & Spa',
  'Jewellery & Accessories',
  'Services',
  'Other',
] as const;

export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

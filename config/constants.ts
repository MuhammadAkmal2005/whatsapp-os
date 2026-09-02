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
  fileUpload: { limit: 30, windowSeconds: 300 },
  publicApi: { limit: 100, windowSeconds: 60 },
  webhook: { limit: 2000, windowSeconds: 60 },
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
export const MAX_RETRIEVED_CHUNKS = 6;
export const MAX_TOOL_CALLS_PER_TURN = 5;

/**
 * Confidence bands. Derived from evidence — retrieval scores, tool success,
 * intent match — never from the model's own claim about itself.
 */
export const CONFIDENCE_HIGH_THRESHOLD = 0.7;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.45;

/** Rough characters-per-token for budgeting before a real tokeniser is wired in. */
export const APPROX_CHARS_PER_TOKEN = 4;

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

// ── Inventory ──────────────────────────────────────────────────────────────
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

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
    description: 'Choose its name, tone and the language it replies in.',
    href: '/settings/agent',
    action: 'Set up your AI',
  },
  knowledge_added: {
    title: 'Teach your AI about your business',
    description: 'Add FAQs, delivery and return policies so answers are accurate.',
    href: '/settings/knowledge',
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

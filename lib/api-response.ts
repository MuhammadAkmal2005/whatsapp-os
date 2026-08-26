/**
 * The API response envelope.
 *
 * Every HTTP endpoint returns one of these two shapes, so a client never has to
 * guess whether a 200 body is data or a problem description:
 *
 *   { success: true,  data: … }
 *   { success: false, error: { code, message, details? } }
 *
 * `code` is a stable machine string that clients may branch on; `message` is
 * safe to show a user. Internal detail — stack traces, SQL, provider payloads —
 * never appears in either, and goes to the structured log against the request
 * id instead.
 *
 * Dependency-free so it can be used in tests and in any runtime.
 */

export type SuccessResponse<T> = {
  success: true;
  data: T;
};

export type ErrorPayload = {
  code: string;
  message: string;
  /** Field-level validation problems, keyed by dotted path. Never free-form
   *  internal text. */
  details?: Record<string, string[]>;
  /** Correlates a user-visible failure with the server log. */
  requestId?: string;
};

export type ErrorResponse = {
  success: false;
  error: ErrorPayload;
};

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export function ok<T>(data: T): SuccessResponse<T> {
  return { success: true, data };
}

export function fail(
  code: string,
  message: string,
  options: { details?: Record<string, string[]>; requestId?: string } = {},
): ErrorResponse {
  const error: ErrorPayload = { code, message };
  if (options.details) error.details = options.details;
  if (options.requestId) error.requestId = options.requestId;
  return { success: false, error };
}

export function isSuccess<T>(response: ApiResponse<T>): response is SuccessResponse<T> {
  return response.success;
}

// ── Pagination ─────────────────────────────────────────────────────────────

/**
 * Offset pagination, for stable lists like products and orders where a page
 * number is meaningful and the underlying rows are not constantly prepended.
 */
export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

export function paginated<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
): Paginated<T> {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}

/**
 * Cursor pagination, for append-heavy lists — messages and conversations.
 *
 * Offset pagination is wrong for a thread: new messages arrive at one end while
 * the reader is paging through it, so page two shifts under them and rows are
 * either duplicated or skipped. A cursor is anchored to a row and cannot drift.
 */
export type CursorPage<T> = {
  items: T[];
  /** Pass back as `cursor` to fetch the next page. Null when exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
};

export function cursorPage<T>(
  items: T[],
  limit: number,
  getCursor: (item: T) => string,
): CursorPage<T> {
  // The caller fetches limit + 1 rows; the extra row is the existence proof for
  // a further page and is not returned.
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    nextCursor: hasMore && last ? getCursor(last) : null,
    hasMore,
  };
}

/**
 * Server bootstrap hook.
 *
 * Next.js calls `register()` once per server instance, before the first request
 * is handled. On Netlify that instance is a Lambda container, so this is the one
 * place where work can be done per-container rather than per-request.
 *
 * What it is used for here: starting the database connection handshake. Prisma
 * connects on first query, which on a cold container means the first request pays
 * DNS, TLS, SCRAM, pooler admission, a possible Neon compute wake, and query-engine
 * init before it does anything useful. Starting it here lets that waiting overlap
 * the rest of the bootstrap.
 *
 * See `db/connection.ts` for why the call is deliberately not awaited.
 */

export async function register(): Promise<void> {
  // `register()` also runs for the edge runtime, where Prisma's native query
  // engine cannot load. Importing it there would throw at module evaluation.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Dynamic so the import is never even reached on edge, and so a failure to
  // resolve the module cannot break the bootstrap of the whole server.
  const { warmUpDatabase } = await import('@/db/connection');

  // Not awaited: awaiting would put the handshake *back* in front of the work it
  // is meant to overlap. `warmUpDatabase()` never rejects, so there is no
  // unhandled rejection to guard against.
  void warmUpDatabase();
}

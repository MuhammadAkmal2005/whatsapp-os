/**
 * Backfill: give every workspace an AI agent.
 *
 * New workspaces get one inside the signup transaction, but any workspace created
 * before that existed has none — and a workspace with no agent cannot answer
 * anybody. The runtime resolves the agent before it does anything else, and when it
 * finds none the turn ends without a reply: the job reports success, no error is
 * raised, and the customer simply never hears back. That is the failure this script
 * removes from an existing database.
 *
 * Idempotent. Re-running it creates nothing and reports every workspace as already
 * covered, so it is safe to include in a deploy step or to run twice by accident.
 *
 * Usage:
 *   npm run db:ensure-agents           apply
 *   npm run db:ensure-agents -- --dry  report what it would do, write nothing
 */

import { DEFAULT_AI_AGENT_GREETING, DEFAULT_AI_AGENT_NAME } from '@/config/constants';
import { env } from '@/config/env';
import { modelForTask } from '@/config/models';
import { prisma } from '@/db/prisma';
import { ensureDefaultAgent } from '@/server/repositories/ai-agent.repository';

type Outcome = { slug: string; name: string; status: 'created' | 'already had one' };

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');

  // Same resolution the signup path uses, so a backfilled row is indistinguishable
  // from one created at signup.
  const model = modelForTask('conversation', {
    primary: env.AI_MODEL,
    fast: env.AI_MODEL_FAST,
  });

  const workspaces = await prisma.workspace.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      _count: { select: { agents: true } },
    },
  });

  if (workspaces.length === 0) {
    console.log('No workspaces found. Nothing to do.');
    return;
  }

  console.log(
    `${workspaces.length} workspace(s). Agent model: ${model}${dryRun ? ' — DRY RUN, no writes' : ''}\n`,
  );

  const outcomes: Outcome[] = [];

  for (const workspace of workspaces) {
    if (workspace._count.agents > 0) {
      outcomes.push({ slug: workspace.slug, name: workspace.name, status: 'already had one' });
      continue;
    }

    if (dryRun) {
      outcomes.push({ slug: workspace.slug, name: workspace.name, status: 'created' });
      continue;
    }

    // Through the repository rather than a local Prisma call, so the definition of
    // "a correct default agent" lives in exactly one place.
    const result = await ensureDefaultAgent(prisma, workspace.id, {
      name: DEFAULT_AI_AGENT_NAME,
      greeting: DEFAULT_AI_AGENT_GREETING,
      model,
    });

    outcomes.push({
      slug: workspace.slug,
      name: workspace.name,
      status: result.created ? 'created' : 'already had one',
    });
  }

  for (const outcome of outcomes) {
    const mark = outcome.status === 'created' ? (dryRun ? 'would create' : 'created') : 'skipped';
    console.log(`  ${mark.padEnd(13)} ${outcome.slug}  (${outcome.name})`);
  }

  const created = outcomes.filter((o) => o.status === 'created').length;
  console.log(
    `\n${dryRun ? 'Would create' : 'Created'} ${created} agent(s); ${outcomes.length - created} workspace(s) already had one.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Backfill failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

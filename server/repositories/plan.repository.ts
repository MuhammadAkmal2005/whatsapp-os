/**
 * Plan repository.
 *
 * The plan catalogue in `config/plans.ts` is the source of truth; the `plans`
 * table is a mirror so a subscription can carry a foreign key and a past plan
 * survives a pricing change. This module is the one that copies catalogue rows
 * into the table.
 *
 * `ensurePlanExists` is idempotent and is called inside workspace creation so a
 * fresh database — or one where the seed has not run — cannot fail a signup on a
 * missing foreign key. `syncAllPlans` is the bulk form the seed uses.
 */

import 'server-only';

import { getPlan, ORDERED_PLANS, type Plan } from '@/config/plans';
import type { Db } from '@/db/prisma';

function planRow(plan: Plan) {
  return {
    key: plan.key,
    name: plan.name,
    description: plan.tagline,
    priceMinor: plan.priceMinor,
    currency: plan.currency,
    interval: plan.interval,
    trialDays: plan.trialDays,
    limits: plan.limits as unknown as object,
    features: plan.features,
    isPublic: plan.isPublic,
    position: plan.position,
  };
}

export async function ensurePlanExists(db: Db, planKey: string): Promise<void> {
  const plan = getPlan(planKey);
  const row = planRow(plan);
  await db.plan.upsert({
    where: { key: plan.key },
    create: row,
    update: {
      name: row.name,
      description: row.description,
      priceMinor: row.priceMinor,
      currency: row.currency,
      interval: row.interval,
      trialDays: row.trialDays,
      limits: row.limits as never,
      features: row.features,
      isPublic: row.isPublic,
      position: row.position,
    },
  });
}

export async function syncAllPlans(db: Db): Promise<void> {
  for (const plan of ORDERED_PLANS) {
    await ensurePlanExists(db, plan.key);
  }
}

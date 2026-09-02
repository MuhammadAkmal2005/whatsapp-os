import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { AutomationForm } from '@/components/automation/automation-form';
import {
  AutomationRunsTable,
  type AutomationRunDTO,
} from '@/components/automation/automation-runs-table';
import { AutomationSummary } from '@/components/automation/automation-summary';
import { MessageDeliveryNote } from '@/components/automation/message-delivery-note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { triggerTypeLabel } from '@/lib/labels';
import { roleHasPermission } from '@/server/authz/permissions';
import { NotFoundError } from '@/server/errors';
import {
  getAutomation,
  listAutomationRuns,
} from '@/server/services/automation/automation.service';
import type { TenantContext } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';
import { uuidSchema } from '@/server/validation/automation';

type RouteParams = Promise<{ id: string }>;

/** How much of the run history this screen shows. Stated to the reader in the table's footer. */
const RECENT_RUNS_LIMIT = 30;

/**
 * Loaded once per request. Next runs `generateMetadata` and the page together and both need
 * the automation; Prisma queries are not deduplicated the way `fetch` is, so without `cache`
 * the same row would be read twice.
 */
const loadAutomation = cache(async (context: TenantContext, id: string) =>
  getAutomation(context, id),
);

export async function generateMetadata({ params }: { params: RouteParams }) {
  const context = await getTenantContext();
  if (!context) return { title: 'Automation' };

  const parsed = uuidSchema.safeParse((await params).id);
  if (!parsed.success) return { title: 'Automation not found' };

  // Cosmetic only, and the page renders the real 404 — so a failed load must not throw here,
  // which would surface as an error boundary instead of a not-found.
  try {
    const automation = await loadAutomation(context, parsed.data);
    return { title: automation.name };
  } catch {
    return { title: 'Automation not found' };
  }
}

export default async function AutomationDetailPage({ params }: { params: RouteParams }) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  // A malformed id is a 404, not a 500: without this the string reaches Prisma, which rejects
  // it as an invalid uuid and turns a mistyped URL into an error page.
  const parsed = uuidSchema.safeParse((await params).id);
  if (!parsed.success) notFound();

  let automation;
  try {
    automation = await loadAutomation(context, parsed.data);
  } catch (error) {
    // An automation in another workspace throws the same NotFoundError as one that does not
    // exist, and the two are meant to be indistinguishable from out here.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const runs = await listAutomationRuns(context, parsed.data, RECENT_RUNS_LIMIT);
  const canUpdate = roleHasPermission(context.role, 'automation:update');

  const formattedRuns: AutomationRunDTO[] = runs.map((run) => ({
    id: run.id,
    subjectType: run.subjectType,
    subjectId: run.subjectId,
    status: run.status,
    currentActionPosition: run.currentActionPosition,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    error: run.error,
  }));

  const actions = automation.actions.map((action) => ({
    id: action.id,
    type: action.type,
    config: (action.config as Record<string, unknown>) ?? {},
  }));

  // Only worth the reader's attention where this rule actually sends something.
  const hasMessageStep = actions.some(
    (action) => action.type === 'SEND_MESSAGE' || action.type === 'SEND_TEMPLATE',
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={automation.name}
        description={automation.description ?? `Starts when ${triggerTypeLabel(automation.triggerType)}.`}
        badges={
          <Badge variant={automation.isActive ? 'success' : 'muted'}>
            {automation.isActive ? 'On' : 'Off'}
          </Badge>
        }
        breadcrumb={
          // Pulled left by the button's own padding so the label lines up with the title below.
          <Button asChild variant="ghost" size="sm" className="-ml-2.5 self-start">
            <Link href="/automations">
              <ArrowLeft aria-hidden />
              All automations
            </Link>
          </Button>
        }
      />

      <Tabs defaultValue="setup">
        <TabsList>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="history">Run history</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="flex flex-col gap-4">
          {canUpdate ? (
            // The builder raises the delivery note itself, as soon as a message step exists —
            // so it is only added here, alongside the read-only view, which cannot.
            <AutomationForm
              initialData={{
                id: automation.id,
                name: automation.name,
                description: automation.description,
                isActive: automation.isActive,
                triggerType: automation.triggerType,
                triggerConfig: (automation.triggerConfig as Record<string, unknown>) ?? null,
                actions,
              }}
            />
          ) : (
            <>
              {hasMessageStep ? <MessageDeliveryNote /> : null}
              <AutomationSummary
                triggerType={automation.triggerType}
                triggerConfig={(automation.triggerConfig as Record<string, unknown>) ?? null}
                actions={actions}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="history">
          <AutomationRunsTable runs={formattedRuns} limit={RECENT_RUNS_LIMIT} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

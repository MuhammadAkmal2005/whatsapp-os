import { PackageX, Plus, Zap } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AutomationFilters } from '@/components/automation/automation-filters';
import { AutomationList, type AutomationItem } from '@/components/automation/automation-list';
import { MessageDeliveryNote } from '@/components/automation/message-delivery-note';
import { TemplatePicker } from '@/components/automation/template-picker';
import { Button } from '@/components/ui/button';
import { CursorPagination } from '@/components/ui/cursor-pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatBand } from '@/components/ui/stat';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { roleHasPermission } from '@/server/authz/permissions';
import {
  getAutomationMetrics,
  listAutomations,
} from '@/server/services/automation/automation.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listAutomationsSchema } from '@/server/validation/automation';

export const metadata = { title: 'Automations' };

/** The filters that survive paging. `cursor` is handled by the pagination footer itself. */
const PRESERVED_FILTERS = ['search', 'active', 'triggerType'] as const;

/**
 * The automations list.
 *
 * Filters come from the URL and go through the same schema the service uses, so a hand-edited
 * query string cannot reach the repository with a trigger that is not a trigger.
 *
 * "This workspace has no rules yet" is read as no filters and no rows rather than from a
 * count, because the count the service returns is narrowed by the status and trigger filters
 * and would call a filtered-to-nothing list a first-time visit.
 */
export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const params = await searchParams;
  const activeParam = firstParam(params.active);
  const parsed = listAutomationsSchema.safeParse({
    search: firstParam(params.search),
    triggerType: firstParam(params.triggerType),
    isActive: activeParam === 'true' ? true : activeParam === 'false' ? false : undefined,
    cursor: firstParam(params.cursor),
  });

  // A stale or hand-edited link falls back to the unfiltered list rather than an error page.
  const input = parsed.success ? parsed.data : listAutomationsSchema.parse({});

  const [page, metrics] = await Promise.all([
    listAutomations(context, input),
    getAutomationMetrics(context),
  ]);

  const canCreate = roleHasPermission(context.role, 'automation:create');
  const canEdit = roleHasPermission(context.role, 'automation:update');
  const canDelete = roleHasPermission(context.role, 'automation:delete');

  const isFiltered = Boolean(input.search || input.triggerType || input.isActive !== undefined);
  const isFirstUse = !isFiltered && !input.cursor && page.items.length === 0;

  const automations: AutomationItem[] = page.items.map((automation) => ({
    id: automation.id,
    name: automation.name,
    description: automation.description,
    isActive: automation.isActive,
    triggerType: automation.triggerType,
    triggerConfig: (automation.triggerConfig as Record<string, unknown>) ?? null,
    actions: automation.actions.map((action) => ({
      id: action.id,
      position: action.position,
      type: action.type,
      config: (action.config as Record<string, unknown>) ?? {},
    })),
    _count: automation._count,
    createdAt: automation.createdAt.toISOString(),
    updatedAt: automation.updatedAt.toISOString(),
  }));

  // The note only earns its space where a message step is actually on offer.
  const hasMessageStep = automations.some((automation) =>
    automation.actions.some(
      (action) => action.type === 'SEND_MESSAGE' || action.type === 'SEND_TEMPLATE',
    ),
  );

  const createButton = (
    <Button asChild>
      <Link href="/automations/new">
        <Plus aria-hidden />
        New automation
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automations"
        description="Rules that run on their own: reply to a common question, tag a customer, nudge a quiet chat, or tell your team when something needs a person."
        actions={canCreate && !isFirstUse ? createButton : undefined}
      />

      {isFirstUse ? (
        <>
          <EmptyState
            icon={Zap}
            title="No automations yet"
            description="An automation waits for something to happen — a message arriving, an order changing, a chat going quiet — and then does the small job you would otherwise do by hand."
            action={canCreate ? createButton : undefined}
            secondaryAction={
              canCreate ? undefined : 'Ask an owner or admin to set up your first automation.'
            }
          />

          {canCreate ? (
            <>
              <MessageDeliveryNote />
              <TemplatePicker />
            </>
          ) : null}
        </>
      ) : (
        <>
          <StatBand columns={3} label="Automation activity">
            <Stat
              label="Switched on"
              value={metrics.activeCount.toLocaleString()}
              hint="running right now"
            />
            <Stat label="Runs, all time" value={metrics.totalRuns.toLocaleString()} />
            <Stat label="Runs, last 24 hours" value={metrics.recentRunsCount.toLocaleString()} />
          </StatBand>

          <AutomationFilters />

          {hasMessageStep ? <MessageDeliveryNote /> : null}

          {automations.length === 0 ? (
            // Two ways to reach an empty page with rules on file: filters that match nothing,
            // or a cursor from a link whose rows have since moved.
            <EmptyState
              icon={PackageX}
              title={isFiltered ? 'No automations match these filters' : 'Nothing left to show'}
              description={
                isFiltered
                  ? 'Try a different trigger, or clear the search to see every automation again.'
                  : 'This page is past the end of your list. It may have changed since this link was made.'
              }
              action={
                <Button asChild variant="outline">
                  <Link href="/automations">
                    {isFiltered ? 'Clear filters' : 'Back to the start'}
                  </Link>
                </Button>
              }
            />
          ) : (
            <AutomationList
              automations={automations}
              canEdit={canEdit}
              canDelete={canDelete}
              footer={
                <CursorPagination
                  basePath="/automations"
                  params={params}
                  preserve={PRESERVED_FILTERS}
                  cursor={page.nextCursor}
                  isPastFirstPage={Boolean(input.cursor)}
                  itemsLabel="automations"
                />
              }
            />
          )}
        </>
      )}
    </div>
  );
}

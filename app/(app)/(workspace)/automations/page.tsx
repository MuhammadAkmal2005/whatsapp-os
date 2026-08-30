import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, Zap } from 'lucide-react';

import { AutomationList, type AutomationItem } from '@/components/automation/automation-list';
import { AutomationStats } from '@/components/automation/automation-stats';
import { TemplatePicker } from '@/components/automation/template-picker';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { firstParam } from '@/lib/search-params';
import { listAutomations, getAutomationMetrics } from '@/server/services/automation/automation.service';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listAutomationsSchema } from '@/server/validation/automation';
import { roleHasPermission } from '@/server/authz/permissions';

export const metadata = { title: 'Automations' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const params = await searchParams;
  const parsed = listAutomationsSchema.safeParse({
    search: firstParam(params.search),
    triggerType: firstParam(params.triggerType),
    isActive: params.isActive === 'true' ? true : params.isActive === 'false' ? false : undefined,
    cursor: firstParam(params.cursor),
  });

  const input = parsed.success ? parsed.data : {};
  const [{ items: automations, total }, metrics] = await Promise.all([
    listAutomations(context, input),
    getAutomationMetrics(context),
  ]);

  const { activeCount, totalRuns, recentRunsCount } = metrics;

  const canCreate = roleHasPermission(context.role, 'automation:create');
  const canEdit = roleHasPermission(context.role, 'automation:update');
  const canDelete = roleHasPermission(context.role, 'automation:delete');

  const createButton = (
    <Button asChild>
      <Link href="/automations/new">
        <Plus className="mr-1.5 size-4" />
        Create Automation
      </Link>
    </Button>
  );

  const formattedAutomations: AutomationItem[] = automations.map((auto) => ({
    id: auto.id,
    name: auto.name,
    description: auto.description,
    isActive: auto.isActive,
    triggerType: auto.triggerType,
    triggerConfig: (auto.triggerConfig as Record<string, unknown>) ?? null,
    actions: auto.actions.map((act) => ({
      id: act.id,
      position: act.position,
      type: act.type,
      config: (act.config as Record<string, unknown>) ?? {},
    })),
    _count: auto._count,
    createdAt: auto.createdAt.toISOString(),
    updatedAt: auto.updatedAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Automations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create automated trigger-and-action rules to engage customers, route conversations, and coordinate team workflows.
          </p>
        </div>
        {canCreate && total > 0 ? createButton : null}
      </div>

      {/* KPI Stats */}
      <AutomationStats
        total={total}
        active={activeCount}
        totalRuns={totalRuns}
        recentRunsCount={recentRunsCount}
      />

      {/* Quick Template Presets */}
      {canCreate && <TemplatePicker />}

      {/* Automations List or Empty State */}
      {total === 0 ? (
        <EmptyState
          icon={Zap}
          title="No automations configured yet"
          description="Automations let you automatically send welcome messages, assign conversations, pause AI during handoffs, tag leads, and set reminders."
          action={canCreate ? createButton : undefined}
          secondaryAction={
            canCreate
              ? undefined
              : 'Ask a workspace Owner or Admin to create your first automation rule.'
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Configured Rules ({total})
            </h2>
          </div>

          <AutomationList
            automations={formattedAutomations}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>
      )}
    </div>
  );
}

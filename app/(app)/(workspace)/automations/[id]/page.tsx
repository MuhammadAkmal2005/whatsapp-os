import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { AutomationForm } from '@/components/automation/automation-form';
import { AutomationRunsTable, type AutomationRunDTO } from '@/components/automation/automation-runs-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getAutomation, listAutomationRuns } from '@/server/services/automation/automation.service';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata = { title: 'Edit Automation' };

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  const { id } = await params;

  let automation;
  try {
    automation = await getAutomation(context, id);
  } catch {
    notFound();
  }

  // Query recent runs for this automation via service
  const runs = await listAutomationRuns(context, id);

  const formattedRuns: AutomationRunDTO[] = runs.map((r) => ({
    id: r.id,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    status: r.status,
    currentActionPosition: r.currentActionPosition,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    error: r.error,
  }));

  const initialData = {
    id: automation.id,
    name: automation.name,
    description: automation.description,
    isActive: automation.isActive,
    triggerType: automation.triggerType,
    triggerConfig: (automation.triggerConfig as Record<string, unknown>) ?? null,
    actions: automation.actions.map((act) => ({
      id: act.id,
      type: act.type,
      config: (act.config as Record<string, unknown>) ?? {},
    })),
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/automations" aria-label="Back to automations">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {automation.name}
              </h1>
              <Badge variant={automation.isActive ? 'default' : 'secondary'} className="text-3xs">
                {automation.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            {automation.description && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {automation.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="config" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:w-[350px]">
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="history">
            Execution Logs ({runs.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4">
          <AutomationForm initialData={initialData} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <AutomationRunsTable runs={formattedRuns} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

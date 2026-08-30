import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { AutomationForm } from '@/components/automation/automation-form';
import { Button } from '@/components/ui/button';
import { firstParam } from '@/lib/search-params';
import { requirePermission } from '@/server/tenancy/context';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata = { title: 'New Automation' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NewAutomationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  requirePermission(context, 'automation:create');

  const params = await searchParams;
  const templateId = firstParam(params.template);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/automations" aria-label="Back to automations">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Create New Automation
          </h1>
          <p className="text-xs text-muted-foreground">
            Configure trigger conditions and multi-action workflows for your shop.
          </p>
        </div>
      </div>

      <AutomationForm templateId={templateId} />
    </div>
  );
}

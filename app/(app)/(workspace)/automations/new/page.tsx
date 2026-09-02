import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AutomationForm } from '@/components/automation/automation-form';
import { findAutomationPreset } from '@/components/automation/presets';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { roleHasPermission } from '@/server/authz/permissions';
import { getTenantContext } from '@/server/tenancy/resolve';

export const metadata = { title: 'New automation' };

export default async function NewAutomationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  // The list page hides "New automation" for a member without the permission, so anyone here
  // typed the URL. The action would refuse them anyway — this means an honest wall rather than
  // a form that fails on save.
  if (!roleHasPermission(context.role, 'automation:create')) redirect('/automations');

  const params = await searchParams;
  const templateId = firstParam(params.template);
  const preset = findAutomationPreset(templateId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={preset ? preset.headline : 'New automation'}
        description={
          preset
            ? 'Everything below is filled in and yours to change. Nothing runs until you save it.'
            : 'Pick what starts the rule, then the steps it should take. Nothing runs until you save it.'
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

      <AutomationForm templateId={templateId} />
    </div>
  );
}

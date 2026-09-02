import { redirect } from 'next/navigation';

import { SettingsNav } from '@/components/app-shell/settings-nav';
import { PageHeader } from '@/components/ui/page-header';
import { getTenantContext } from '@/server/tenancy/resolve';

/**
 * The settings shell.
 *
 * Resolves the tenant context once and hands the role to the section list. Each
 * settings page resolves its own context too — Next memoises the lookup, so that
 * costs nothing, and it means no page depends on a layout having run to be secure.
 *
 * The heading lives here rather than on each page because every settings screen is a section
 * of one thing. The section list is the second level of that heading, so the pages below open
 * with their own card titles instead of repeating the word Settings.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description={`Set up how ${context.workspaceName} runs on ConvoNexa.`}
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <aside className="lg:w-56 lg:shrink-0">
          <SettingsNav role={context.role} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

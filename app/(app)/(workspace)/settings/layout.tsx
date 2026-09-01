import { redirect } from 'next/navigation';

import { SettingsNav } from '@/components/app-shell/settings-nav';
import { getTenantContext } from '@/server/tenancy/resolve';

/**
 * The settings shell.
 *
 * Resolves the tenant context once and hands the role to the section list. Each
 * settings page resolves its own context too — Next memoises the lookup, so that
 * costs nothing, and it means no page depends on a layout having run to be secure.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const context = await getTenantContext();
  if (!context) redirect('/select-workspace');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Set up how {context.workspaceName} runs on ConvoNexa.
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <aside className="lg:w-56 lg:shrink-0">
          <SettingsNav role={context.role} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

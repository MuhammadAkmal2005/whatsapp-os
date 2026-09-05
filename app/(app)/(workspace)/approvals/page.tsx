import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { getTenantContext } from '@/server/tenancy/resolve';
import { listPendingApprovals } from '@/server/services/approval/approval.service';
import { ApprovalsList } from '@/components/approvals/approvals-list';

export const metadata: Metadata = {
  title: 'Approvals',
  description: 'Review and approve sensitive actions requested by the AI employee.',
};

export default async function ApprovalsPage() {
  const context = await getTenantContext();
  if (!context) {
    redirect('/select-workspace');
  }

  const approvals = await listPendingApprovals(context);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Action Approvals"
        description="Review and authorize sensitive customer actions (such as order cancellations, modifications, or refunds) that require human staff approval."
      />

      <ApprovalsList approvals={approvals} />
    </div>
  );
}

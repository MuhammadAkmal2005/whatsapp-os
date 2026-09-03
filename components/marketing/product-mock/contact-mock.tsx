import { Badge } from '@/components/ui/badge';
import { DEFAULT_CURRENCY } from '@/config/constants';
import { formatMoney, money } from '@/lib/money';

import { SAMPLE_ORDER } from '../sample-data';

/**
 * A customer record, assembled from the conversation rather than typed in by anyone.
 *
 * The detail worth noticing is the bottom row: the note was written by a person and the
 * record was created by the assistant. That division — machine gathers, human annotates — is
 * the thing the CRM is for, and it is easier to show than to describe.
 */

const LIFETIME_SPEND = formatMoney(money(2_498_000, DEFAULT_CURRENCY)); // Rs. 24,980

const FIELDS = [
  { label: 'Orders', value: '4' },
  { label: 'Total spent', value: LIFETIME_SPEND },
  { label: 'First seen', value: 'Mar 2026' },
  { label: 'Last message', value: '2 minutes ago' },
] as const;

export function ContactMock() {
  return (
    <div className="flex flex-col bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-surface text-xs font-semibold text-primary">
          AK
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">Ayesha K.</p>
          <p className="truncate text-2xs text-muted-foreground">
            {SAMPLE_ORDER.city} · WhatsApp · +92 3•• ••• ••••
          </p>
        </div>
        <Badge variant="default" size="sm" className="ml-auto shrink-0">
          Returning
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
        <Badge variant="muted" size="sm">
          Prefers COD
        </Badge>
        <Badge variant="muted" size="sm">
          Kurta buyer
        </Badge>
        <Badge variant="muted" size="sm">
          Roman Urdu
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
        {FIELDS.map((field) => (
          <div key={field.label} className="flex flex-col gap-0.5">
            <dt className="text-3xs font-medium uppercase tracking-wide text-muted-foreground">
              {field.label}
            </dt>
            <dd className="text-xs tabular-nums text-foreground">{field.value}</dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-border bg-surface-sunken px-4 py-3">
        <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
          Note from Sana
        </p>
        <p className="mt-1 text-xs leading-relaxed text-foreground">
          Always asks for XL. Send the new arrivals to her first.
        </p>
      </div>
    </div>
  );
}

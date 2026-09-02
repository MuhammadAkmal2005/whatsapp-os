'use client';

import { AlertTriangle, Check, Download, RefreshCw } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { exportAnalyticsReportAction } from '@/server/actions/analytics.actions';

const PRESETS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
] as const;

/** What happened to the last export. Drives the feedback under the header. */
type ExportState =
  | { status: 'idle' }
  | { status: 'done'; filename: string }
  | { status: 'failed'; message: string };

interface AnalyticsHeaderProps {
  /** The active preset key, or `custom` when explicit dates are in the URL. */
  currentRange: string;
  /** The active range in words — the only place a custom range is ever shown. */
  formattedRange: string;
  /** The resolved period, ISO, so an export covers what is on screen. */
  from: string;
  to: string;
}

/**
 * The analytics page header: what this screen covers, and the three things you can do to it.
 *
 * Two failures used to be invisible here. A rejected export — no permission, a service error —
 * returned `success: false` and nothing happened on screen, and a thrown error was swallowed by
 * an empty `catch`. Since a CSV download is silent when it works, a silent failure is
 * indistinguishable from success, so the button appeared broken. Both paths now report, and the
 * successful one names the file so the reader knows what to look for in their downloads folder.
 *
 * The export also carries the selected period. It previously sent no dates at all, so the button
 * sitting beside "Last 7 days" quietly produced the service's default range instead.
 */
export function AnalyticsHeader({
  currentRange,
  formattedRange,
  from,
  to,
}: AnalyticsHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Two transitions rather than one, so the refresh button does not spin because the range
  // changed, and the range picker does not look busy because someone hit refresh.
  const [isChangingRange, startRangeChange] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const [isExporting, setIsExporting] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  const handleRangeChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('range', value);
    // A preset and explicit dates cannot both be in force; the preset wins.
    params.delete('from');
    params.delete('to');

    // Last export's outcome described a different period, so it stops being true here.
    setExportState({ status: 'idle' });

    startRangeChange(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handleRefresh = () => {
    startRefresh(() => {
      router.refresh();
    });
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportState({ status: 'idle' });

    try {
      const result = await exportAnalyticsReportAction({
        reportType: 'overview',
        format: 'csv',
        from,
        to,
      });

      if (!result.success) {
        setExportState({ status: 'failed', message: result.error });
        return;
      }

      downloadTextFile(result.data);
      setExportState({ status: 'done', filename: result.data.filename });
    } catch {
      // A rejected action means the request never completed — a dropped connection, or a
      // deploy mid-request. The server-side reason, if there was one, is in the logs; what
      // the reader needs is that nothing was downloaded and the action is safe to repeat.
      setExportState({
        status: 'failed',
        message: 'We could not reach the server. Check your connection and try again.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Analytics"
        description={
          <>
            Sales, conversations and AI activity across your workspace. Showing{' '}
            <span className="font-medium text-foreground">{formattedRange}</span>.
          </>
        }
        actions={
          <>
            <Select
              value={currentRange}
              onValueChange={handleRangeChange}
              disabled={isChangingRange}
            >
              <SelectTrigger className="w-40" aria-label="Period shown">
                <SelectValue placeholder="Custom range" />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={handleExport}
              isLoading={isExporting}
              disabled={isChangingRange}
            >
              {isExporting ? null : <Download aria-hidden />}
              Export CSV
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              isLoading={isRefreshing}
              aria-label="Reload the figures"
            >
              {isRefreshing ? null : <RefreshCw aria-hidden />}
            </Button>
          </>
        }
      />

      {exportState.status === 'failed' ? (
        <Alert variant="destructive" live="assertive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Your report wasn&apos;t downloaded</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>{exportState.message}</p>
            <Button variant="outline" size="sm" onClick={handleExport} isLoading={isExporting}>
              Try the export again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {exportState.status === 'done' ? (
        // A browser download can be entirely silent, so the filename is the confirmation.
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 shrink-0 text-success" aria-hidden />
          Downloaded <span className="font-mono text-foreground">{exportState.filename}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Hands a generated report to the browser as a download.
 *
 * The blob URL is revoked immediately after the synthetic click; the download has already been
 * handed to the browser by then, and leaving it live leaks the whole report into memory for as
 * long as the page is open.
 */
function downloadTextFile(file: { content: string; mimeType: string; filename: string }): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

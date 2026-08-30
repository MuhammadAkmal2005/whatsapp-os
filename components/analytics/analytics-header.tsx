'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Calendar, Download, RefreshCw } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { exportAnalyticsReportAction } from '@/server/actions/analytics.actions';

const PRESETS = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
] as const;

export type AnalyticsRangePreset = (typeof PRESETS)[number]['value'];

interface AnalyticsHeaderProps {
  currentRange: string;
  formattedRange: string;
}

export function AnalyticsHeader({ currentRange, formattedRange }: AnalyticsHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isExporting, setIsExporting] = useState(false);

  const handleRangeChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('range', value);
    // Remove custom dates if selecting preset
    params.delete('from');
    params.delete('to');

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const handleExport = async (format: 'csv' | 'json' = 'csv') => {
    try {
      setIsExporting(true);
      const res = await exportAnalyticsReportAction({
        reportType: 'overview',
        format,
      });

      if (res.success && res.data) {
        const blob = new Blob([res.data.content], { type: res.data.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      // Graceful error handling
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics & Usage</h1>
        <p className="text-sm text-muted-foreground">
          Real-time metrics, AI cost attribution, and subscription limits for {formattedRange}.
        </p>
      </div>

      <div className="flex items-center gap-2 self-start sm:self-auto">
        <Select value={currentRange} onValueChange={handleRangeChange} disabled={isPending}>
          <SelectTrigger className="w-[160px] h-9">
            <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue placeholder="Select Range" />
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
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => handleExport('csv')}
          disabled={isExporting || isPending}
          title="Export CSV report"
        >
          <Download className={`h-4 w-4 ${isExporting ? 'animate-spin' : ''}`} />
          <span>Export CSV</span>
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={handleRefresh}
          disabled={isPending}
          title="Refresh metrics"
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
          <span className="sr-only">Refresh data</span>
        </Button>
      </div>
    </div>
  );
}

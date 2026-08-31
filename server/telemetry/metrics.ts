/**
 * OpenTelemetry and Prometheus-compatible in-memory metrics registry.
 *
 * Implements low-overhead, thread-safe metrics collection for HTTP requests,
 * background jobs, AI token usage, database query latencies, rate limit events,
 * and system resources.
 *
 * Designed with cardinality guardrails to prevent memory exhaustion:
 * - Request paths are normalized and identifiers stripped.
 * - Labels are bounded and sanitized.
 * - Customer personal data, messages, tokens, and keys are strictly excluded.
 */

export type LabelValues = Record<string, string | number>;

function serializeLabels(labels?: LabelValues): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(',');
}

export class Counter {
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];
  private values = new Map<string, { labels?: LabelValues; value: number }>();
  private readonly maxCombinations: number;

  constructor(name: string, help: string, labelNames: readonly string[] = [], maxCombinations = 1000) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.maxCombinations = maxCombinations;
  }

  inc(labels?: LabelValues, amount = 1): void {
    if (amount < 0) throw new Error(`Counter ${this.name} cannot be decremented.`);
    const key = serializeLabels(labels);
    const existing = this.values.get(key);

    if (existing) {
      existing.value += amount;
    } else if (this.values.size < this.maxCombinations) {
      this.values.set(key, { labels, value: amount });
    } else {
      // Cardinality fallback
      const fallbackKey = 'overflow="true"';
      const overflow = this.values.get(fallbackKey);
      if (overflow) {
        overflow.value += amount;
      } else {
        this.values.set(fallbackKey, { labels: { overflow: 'true' }, value: amount });
      }
    }
  }

  get(labels?: LabelValues): number {
    const key = serializeLabels(labels);
    return this.values.get(key)?.value ?? 0;
  }

  reset(): void {
    this.values.clear();
  }

  collect(): { labels?: LabelValues; value: number }[] {
    return Array.from(this.values.values());
  }
}

export class Gauge {
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];
  private values = new Map<string, { labels?: LabelValues; value: number }>();
  private readonly maxCombinations: number;

  constructor(name: string, help: string, labelNames: readonly string[] = [], maxCombinations = 1000) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.maxCombinations = maxCombinations;
  }

  set(value: number, labels?: LabelValues): void {
    const key = serializeLabels(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value = value;
    } else if (this.values.size < this.maxCombinations) {
      this.values.set(key, { labels, value });
    }
  }

  inc(labels?: LabelValues, amount = 1): void {
    const key = serializeLabels(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += amount;
    } else if (this.values.size < this.maxCombinations) {
      this.values.set(key, { labels, value: amount });
    }
  }

  dec(labels?: LabelValues, amount = 1): void {
    this.inc(labels, -amount);
  }

  get(labels?: LabelValues): number {
    const key = serializeLabels(labels);
    return this.values.get(key)?.value ?? 0;
  }

  reset(): void {
    this.values.clear();
  }

  collect(): { labels?: LabelValues; value: number }[] {
    return Array.from(this.values.values());
  }
}

export type HistogramBucket = number;

export const DEFAULT_BUCKETS: readonly HistogramBucket[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

type HistogramValue = {
  labels?: LabelValues;
  count: number;
  sum: number;
  bucketCounts: Map<number, number>;
};

export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly buckets: readonly number[];
  private values = new Map<string, HistogramValue>();
  private readonly maxCombinations: number;

  constructor(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
    maxCombinations = 500,
  ) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.maxCombinations = maxCombinations;
  }

  observe(value: number, labels?: LabelValues): void {
    const key = serializeLabels(labels);
    let state = this.values.get(key);

    if (!state) {
      if (this.values.size >= this.maxCombinations) return;
      state = {
        labels,
        count: 0,
        sum: 0,
        bucketCounts: new Map(this.buckets.map((b) => [b, 0])),
      };
      this.values.set(key, state);
    }

    state.count += 1;
    state.sum += value;

    for (const b of this.buckets) {
      if (value <= b) {
        state.bucketCounts.set(b, (state.bucketCounts.get(b) ?? 0) + 1);
      }
    }
  }

  reset(): void {
    this.values.clear();
  }

  collect(): HistogramValue[] {
    return Array.from(this.values.values());
  }
}

/**
 * Normalizes HTTP paths to prevent high-cardinality label explosions.
 * Replaces UUIDs, numbers, and query strings with fixed parameters.
 */
export function normalizeMetricPath(rawPath: string): string {
  if (!rawPath) return '/';
  const urlPath = rawPath.split('?')[0] || '/';
  const path = urlPath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

  // Specific well-known prefixes
  if (path.startsWith('/api/webhooks/whatsapp')) return '/api/webhooks/whatsapp';
  if (path.startsWith('/api/webhooks/billing')) return '/api/webhooks/billing';
  if (path.startsWith('/api/health')) return path;
  if (path === '/api/metrics') return '/api/metrics';

  // Normalize generic UUIDs and numbers
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

/**
 * Central metrics registry for the application.
 */
export class MetricsRegistry {
  // HTTP
  readonly httpRequests = new Counter('http_requests_total', 'Total HTTP requests processed', [
    'method',
    'path',
    'status',
  ]);
  readonly httpRequestDuration = new Histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'path'],
  );

  // Background Job Queue
  readonly jobsProcessed = new Counter('jobs_processed_total', 'Total background jobs processed', [
    'type',
    'status',
  ]);
  readonly jobDuration = new Histogram('job_duration_seconds', 'Background job execution duration in seconds', [
    'type',
  ]);
  readonly jobQueueDepth = new Gauge('job_queue_depth', 'Current background job queue depth by status', [
    'status',
  ]);
  readonly jobQueueOldestPendingAge = new Gauge(
    'job_queue_oldest_pending_age_seconds',
    'Age in seconds of the oldest pending job',
  );

  // AI & RAG
  readonly aiRequests = new Counter('ai_requests_total', 'Total AI model invocations', ['model', 'status']);
  readonly aiTokens = new Counter('ai_tokens_total', 'Total AI tokens consumed', ['model', 'type']);
  readonly aiRequestDuration = new Histogram(
    'ai_request_duration_seconds',
    'AI invocation duration in seconds',
    ['model'],
  );

  // Webhooks
  readonly webhookEvents = new Counter('webhook_events_total', 'Total inbound webhook events ingested', [
    'provider',
    'eventType',
    'status',
  ]);

  // Security & Rate Limiting
  readonly rateLimitHits = new Counter('rate_limit_hits_total', 'Total rate limit rejections', ['tier']);
  readonly securityViolations = new Counter('security_violations_total', 'Total detected security anomalies', [
    'type',
  ]);

  // Process & Database
  readonly dbQueryDuration = new Histogram(
    'db_query_duration_seconds',
    'Database query execution latency in seconds',
    ['operation'],
  );
  readonly processUptime = new Gauge('process_uptime_seconds', 'Process uptime in seconds');
  readonly processHeapBytes = new Gauge('process_heap_bytes', 'Node.js memory heap usage in bytes');

  reset(): void {
    this.httpRequests.reset();
    this.httpRequestDuration.reset();
    this.jobsProcessed.reset();
    this.jobDuration.reset();
    this.jobQueueDepth.reset();
    this.jobQueueOldestPendingAge.reset();
    this.aiRequests.reset();
    this.aiTokens.reset();
    this.aiRequestDuration.reset();
    this.webhookEvents.reset();
    this.rateLimitHits.reset();
    this.securityViolations.reset();
    this.dbQueryDuration.reset();
    this.processUptime.reset();
    this.processHeapBytes.reset();
  }

  updateSystemGauges(): void {
    this.processUptime.set(Math.floor(process.uptime()));
    if (typeof process.memoryUsage === 'function') {
      this.processHeapBytes.set(process.memoryUsage().heapUsed);
    }
  }

  toPrometheusText(): string {
    this.updateSystemGauges();
    const lines: string[] = [];

    // Helper to format counters & gauges
    const appendSimpleMetric = (
      name: string,
      help: string,
      type: 'counter' | 'gauge',
      items: { labels?: LabelValues; value: number }[],
    ) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      for (const item of items) {
        const lbls = serializeLabels(item.labels);
        lines.push(`${name}${lbls ? `{${lbls}}` : ''} ${item.value}`);
      }
    };

    // Helper to format histograms
    const appendHistogram = (
      name: string,
      help: string,
      items: HistogramValue[],
      buckets: readonly number[],
    ) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const item of items) {
        const baseLabels = serializeLabels(item.labels);
        const prefix = baseLabels ? `${baseLabels},` : '';

        let cumulative = 0;
        for (const b of buckets) {
          cumulative = item.bucketCounts.get(b) ?? cumulative;
          lines.push(`${name}_bucket{${prefix}le="${b}"} ${cumulative}`);
        }
        lines.push(`${name}_bucket{${prefix}le="+Inf"} ${item.count}`);
        lines.push(`${name}_sum{${baseLabels ? `{${baseLabels}}` : ''}} ${item.sum}`);
        lines.push(`${name}_count{${baseLabels ? `{${baseLabels}}` : ''}} ${item.count}`);
      }
    };

    appendSimpleMetric('http_requests_total', this.httpRequests.help, 'counter', this.httpRequests.collect());
    appendHistogram('http_request_duration_seconds', this.httpRequestDuration.help, this.httpRequestDuration.collect(), this.httpRequestDuration.buckets);

    appendSimpleMetric('jobs_processed_total', this.jobsProcessed.help, 'counter', this.jobsProcessed.collect());
    appendHistogram('job_duration_seconds', this.jobDuration.help, this.jobDuration.collect(), this.jobDuration.buckets);
    appendSimpleMetric('job_queue_depth', this.jobQueueDepth.help, 'gauge', this.jobQueueDepth.collect());
    appendSimpleMetric('job_queue_oldest_pending_age_seconds', this.jobQueueOldestPendingAge.help, 'gauge', this.jobQueueOldestPendingAge.collect());

    appendSimpleMetric('ai_requests_total', this.aiRequests.help, 'counter', this.aiRequests.collect());
    appendSimpleMetric('ai_tokens_total', this.aiTokens.help, 'counter', this.aiTokens.collect());
    appendHistogram('ai_request_duration_seconds', this.aiRequestDuration.help, this.aiRequestDuration.collect(), this.aiRequestDuration.buckets);

    appendSimpleMetric('webhook_events_total', this.webhookEvents.help, 'counter', this.webhookEvents.collect());
    appendSimpleMetric('rate_limit_hits_total', this.rateLimitHits.help, 'counter', this.rateLimitHits.collect());
    appendSimpleMetric('security_violations_total', this.securityViolations.help, 'counter', this.securityViolations.collect());

    appendHistogram('db_query_duration_seconds', this.dbQueryDuration.help, this.dbQueryDuration.collect(), this.dbQueryDuration.buckets);
    appendSimpleMetric('process_uptime_seconds', this.processUptime.help, 'gauge', this.processUptime.collect());
    appendSimpleMetric('process_heap_bytes', this.processHeapBytes.help, 'gauge', this.processHeapBytes.collect());

    return lines.join('\n') + '\n';
  }

  toJSON(): Record<string, unknown> {
    this.updateSystemGauges();
    return {
      httpRequests: this.httpRequests.collect(),
      httpRequestDuration: this.httpRequestDuration.collect(),
      jobsProcessed: this.jobsProcessed.collect(),
      jobDuration: this.jobDuration.collect(),
      jobQueueDepth: this.jobQueueDepth.collect(),
      jobQueueOldestPendingAgeSeconds: this.jobQueueOldestPendingAge.get(),
      aiRequests: this.aiRequests.collect(),
      aiTokens: this.aiTokens.collect(),
      aiRequestDuration: this.aiRequestDuration.collect(),
      webhookEvents: this.webhookEvents.collect(),
      rateLimitHits: this.rateLimitHits.collect(),
      securityViolations: this.securityViolations.collect(),
      processUptimeSeconds: this.processUptime.get(),
      processHeapBytes: this.processHeapBytes.get(),
    };
  }
}

export const metricsRegistry = new MetricsRegistry();

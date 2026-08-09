// ── Telemetry bootstrap (OTEL → PostHog) — oteltrace reference, TypeScript ──
//
// A single, FAIL-SOFT bootstrap that stands up native OTEL trace + log pipelines
// exporting to PostHog's OTLP endpoints (`/i/v1/traces`, `/i/v1/logs`, with
// `Authorization: Bearer <phc_ token>`), plus an ALWAYS-ON console log exporter.
//
// Load-bearing rules (these are the patterns the skill exists to encode — the
// governing document is OTEL-STANDARD.md, which wins over this file on conflict):
//   * Console is an EXPORTER on the same provider, never a second code path (§0).
//     It is registered on EVERY init path (enabled, disabled, fail-soft).
//   * Logs are emitted via the native OTEL Logs API (see logger.ts). §0 permits a
//     logging-lib bridge too — this reference emits natively because the pino
//     bridge silently dropped every record under pure ESM.
//   * Resource attributes are set ONCE on the providers, so every signal carries
//     service.name / service.version / deployment.environment (§0).
//   * Register the tracer provider LAST, after the whole pipeline is built, so a
//     throw mid-setup can't leave a registered-but-abandoned provider exporting.
//   * On error: shut down partially-initialised providers, then degrade to
//     console-only. Fall back to Resource.empty() rather than re-running a
//     buildResource() that just threw. createTelemetry NEVER throws.
//   * Redaction is configured ONCE, ahead of every exporter, on BOTH pipelines —
//     logs and spans are separate code paths and §9 requires auditing each.
//
// This bootstrap only REGISTERS providers; it opens no span. One trace per unit
// of work, opened at the real trigger (§1, §2) — never one per process start.
//
// PostHog requires the `/i/v1/...` ingestion paths on the `i.` host; the generic
// OTEL_EXPORTER_OTLP_ENDPOINT convention 404s there.
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { logs } from '@opentelemetry/api-logs';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from '@opentelemetry/exporter-metrics-otlp-http';
import { makeRedactingSpanExporter, makeRedactionProcessor } from './redaction.js';

/** The typed observability slice. Build this from your project's validated env. */
export interface ObservabilityConfig {
  /** Telemetry only stands up when true (e.g. OTEL_ENABLED !== false && token present). */
  enabled: boolean;
  /** `service.name` resource attribute (PostHog routing/filter dimension). */
  serviceName: string;
  serviceVersion: string;
  /** `deployment.environment` (e.g. DEV/STG/PRD). */
  environment: string;
  /** PostHog ingestion host, e.g. https://eu.i.posthog.com */
  host: string;
  /** `phc_` project key sent as `Authorization: Bearer <token>`. */
  apiKey: string | undefined;
  /** ParentBased(TraceIdRatioBased) head-sampling ratio (0..1). Lower in PRD. */
  samplerRatio: number;
}

/** Derive the OTLP URLs PostHog actually accepts from the ingestion host. */
function otlpUrls(host: string): { tracesUrl: string; logsUrl: string; metricsUrl: string } {
  const h = host.replace(/\/+$/, '');
  return {
    tracesUrl: `${h}/i/v1/traces`,
    logsUrl: `${h}/i/v1/logs`,
    metricsUrl: `${h}/i/v1/metrics`,
  };
}

export interface TelemetryHandle {
  /** True only when the PostHog export pipeline constructed successfully. */
  enabled: boolean;
  /** Reused by a Temporal workflow Sink so sandbox spans export through one exporter. */
  workflowSpanProcessor: SpanProcessor | undefined;
  resource: Resource;
  /** Flush + shut down the registered providers. Fail-soft; never throws. */
  shutdown(): Promise<void>;
}

/** Direct-to-stderr diagnostic — the logger isn't usable until this registers the provider. */
function diag(message: string, err?: unknown): void {
  try {
    const d = err instanceof Error ? `: ${err.message}` : err !== undefined ? `: ${String(err)}` : '';
    process.stderr.write(`[telemetry] ${message}${d}\n`);
  } catch {
    /* diagnostics must never throw */
  }
}

function buildResource(obs: ObservabilityConfig): Resource {
  return new Resource({
    [ATTR_SERVICE_NAME]: obs.serviceName,
    [ATTR_SERVICE_VERSION]: obs.serviceVersion,
    // PostHog's Environment facet keys on the CURRENT semconv name
    // (`deployment.environment.name`); `deployment.environment` is the legacy
    // key. Emit both so the facet appears and older tooling still resolves.
    'deployment.environment.name': obs.environment,
    'deployment.environment': obs.environment,
  });
}
// NOTE (OTel JS 2.x): `new Resource({...})` was removed — use
// `resourceFromAttributes({...})` from @opentelemetry/resources, which is what
// PostHog's own docs show. See KNOWN-GOOD-VERSIONS.md; this file targets 1.x.

/**
 * Register a global LoggerProvider carrying the ALWAYS-ON console log exporter.
 *
 * Redaction is added FIRST, ahead of the console exporter, so it is configured
 * once and applies to console and remote output alike (OTEL-STANDARD.md §0) —
 * console is an exporter on this provider, not a second code path.
 */
function registerConsoleLoggerProvider(resource: Resource): LoggerProvider {
  const provider = new LoggerProvider({ resource });
  provider.addLogRecordProcessor(makeRedactionProcessor()); // scrub before ANY exporter
  provider.addLogRecordProcessor(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
  logs.setGlobalLoggerProvider(provider);
  return provider;
}

/** Console-only handle: native console logging on, no PostHog export, no tracer. */
function consoleOnlyHandle(resource: Resource): TelemetryHandle {
  const loggerProvider = registerConsoleLoggerProvider(resource);
  return {
    enabled: false,
    workflowSpanProcessor: undefined,
    resource,
    shutdown: async () => {
      try {
        await loggerProvider.shutdown();
      } catch (err) {
        diag('logger provider shutdown error', err);
      }
    },
  };
}

/**
 * Build the telemetry pipeline. PURE factory; wrap in a process singleton for the
 * real bootstrap. NEVER throws — disabled/any error degrades to console-only.
 */
export function createTelemetry(obs: ObservabilityConfig): TelemetryHandle {
  let resource: Resource | undefined;
  // Declared in the outer scope so the catch can shut down whatever was built.
  let tracerProvider: NodeTracerProvider | undefined;
  let loggerProvider: LoggerProvider | undefined;
  let meterProvider: MeterProvider | undefined;

  try {
    resource = buildResource(obs);

    // Console logging is ALWAYS on. When disabled, that's all we register.
    if (!obs.enabled) {
      return consoleOnlyHandle(resource);
    }

    const headers: Record<string, string> = obs.apiKey ? { Authorization: `Bearer ${obs.apiKey}` } : {};
    const { tracesUrl, logsUrl, metricsUrl } = otlpUrls(obs.host);

    // ── Traces ── (build providers; DON'T register the tracer yet)
    // The trace pipeline gets its OWN redaction — the log pipeline having a
    // scrubber says nothing about this one (OTEL-STANDARD.md §9), and it is
    // auto-instrumentation, not your code, that records request targets verbatim.
    const traceExporter = makeRedactingSpanExporter(
      new OTLPTraceExporter({ url: tracesUrl, headers }),
    );
    const workflowSpanProcessor = new BatchSpanProcessor(traceExporter);
    const consoleSpanProcessor = new SimpleSpanProcessor(
      makeRedactingSpanExporter(new ConsoleSpanExporter()),
    );
    tracerProvider = new NodeTracerProvider({
      resource,
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(obs.samplerRatio) }),
      spanProcessors: [workflowSpanProcessor, consoleSpanProcessor],
    });

    // ── Logs ── redact → console (both registered above) → OTLP→PostHog.
    loggerProvider = registerConsoleLoggerProvider(resource);
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(new OTLPLogExporter({ url: logsUrl, headers })),
    );

    // ── Metrics ── §1 makes these mandatory, not optional: the moment a span is
    // conditional, "no span" and "the process is dead" become indistinguishable,
    // so liveness lives here (see gating.ts). DELTA temporality is requested
    // explicitly — with cumulative, summing double-counts (§8).
    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: metricsUrl,
            headers,
            temporalityPreference: AggregationTemporalityPreference.DELTA,
          }),
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    // Register the global tracer provider LAST — a throw above can't leak it now.
    tracerProvider.register();

    diag(`initialised (service.name=${obs.serviceName}, env=${obs.environment}, sampler=${obs.samplerRatio})`);

    return {
      enabled: true,
      workflowSpanProcessor,
      resource,
      shutdown: async () => {
        try {
          await tracerProvider?.shutdown();
        } catch (err) {
          diag('tracer provider shutdown error', err);
        }
        try {
          await loggerProvider?.shutdown();
        } catch (err) {
          diag('logger provider shutdown error', err);
        }
        try {
          await meterProvider?.shutdown();
        } catch (err) {
          diag('meter provider shutdown error', err);
        }
      },
    };
  } catch (err) {
    // Shut down whatever was already built so nothing keeps exporting after degrade.
    void tracerProvider?.shutdown().catch((e) => diag('tracer provider shutdown error', e));
    void loggerProvider?.shutdown().catch((e) => diag('logger provider shutdown error', e));
    void meterProvider?.shutdown().catch((e) => diag('meter provider shutdown error', e));
    diag('telemetry init failed; console logging only (fail-soft)', err);
    try {
      return consoleOnlyHandle(resource ?? Resource.empty());
    } catch (innerErr) {
      diag('console logger provider init failed (fail-soft)', innerErr);
      return {
        enabled: false,
        workflowSpanProcessor: undefined,
        resource: resource ?? Resource.empty(),
        shutdown: async () => {},
      };
    }
  }
}

// Process singleton — call initTelemetry once at the entrypoint, before consumers.
let singleton: TelemetryHandle | undefined;

export function initTelemetry(obs: ObservabilityConfig): TelemetryHandle {
  if (!singleton) singleton = createTelemetry(obs);
  return singleton;
}

export function getTelemetry(): TelemetryHandle | undefined {
  return singleton;
}

export async function shutdownTelemetry(): Promise<void> {
  if (singleton) {
    await singleton.shutdown();
    singleton = undefined;
  }
}

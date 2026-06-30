// ── Telemetry bootstrap (OTEL → PostHog) — oteltrace reference, TypeScript ──
//
// A single, FAIL-SOFT bootstrap that stands up native OTEL trace + log pipelines
// exporting to PostHog's OTLP endpoints (`/i/v1/traces`, `/i/v1/logs`, with
// `Authorization: Bearer <phc_ token>`), plus an ALWAYS-ON console log exporter.
//
// Load-bearing rules (these are the patterns the skill exists to encode):
//   * Console logging via the native ConsoleLogRecordExporter is registered on
//     EVERY path (enabled, disabled, fail-soft) — independent of PostHog export.
//   * Logs are emitted via the native OTEL Logs API (see logger.ts) — no bridge.
//   * Register the tracer provider LAST, after the whole pipeline is built, so a
//     throw mid-setup can't leave a registered-but-abandoned provider exporting.
//   * On error: shut down partially-initialised providers, then degrade to
//     console-only. Fall back to Resource.empty() rather than re-running a
//     buildResource() that just threw. createTelemetry NEVER throws.
//   * Redaction runs BEFORE the OTLP log exporter (see redaction.ts).
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
import { makeRedactionProcessor } from './redaction.js';

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

/** Derive the two OTLP URLs PostHog actually accepts from the ingestion host. */
function otlpUrls(host: string): { tracesUrl: string; logsUrl: string } {
  const h = host.replace(/\/+$/, '');
  return { tracesUrl: `${h}/i/v1/traces`, logsUrl: `${h}/i/v1/logs` };
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
    'deployment.environment': obs.environment,
  });
}

/** Register a global LoggerProvider carrying the ALWAYS-ON console log exporter. */
function registerConsoleLoggerProvider(resource: Resource): LoggerProvider {
  const provider = new LoggerProvider({ resource });
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

  try {
    resource = buildResource(obs);

    // Console logging is ALWAYS on. When disabled, that's all we register.
    if (!obs.enabled) {
      return consoleOnlyHandle(resource);
    }

    const headers: Record<string, string> = obs.apiKey ? { Authorization: `Bearer ${obs.apiKey}` } : {};
    const { tracesUrl, logsUrl } = otlpUrls(obs.host);

    // ── Traces ── (build providers; DON'T register the tracer yet)
    const traceExporter = new OTLPTraceExporter({ url: tracesUrl, headers });
    const workflowSpanProcessor = new BatchSpanProcessor(traceExporter);
    const consoleSpanProcessor = new SimpleSpanProcessor(new ConsoleSpanExporter());
    tracerProvider = new NodeTracerProvider({
      resource,
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(obs.samplerRatio) }),
      spanProcessors: [workflowSpanProcessor, consoleSpanProcessor],
    });

    // ── Logs ── always-on console provider, then REDACT, then OTLP→PostHog.
    loggerProvider = registerConsoleLoggerProvider(resource);
    loggerProvider.addLogRecordProcessor(makeRedactionProcessor()); // scrub before export
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(new OTLPLogExporter({ url: logsUrl, headers })),
    );

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
      },
    };
  } catch (err) {
    // Shut down whatever was already built so nothing keeps exporting after degrade.
    void tracerProvider?.shutdown().catch((e) => diag('tracer provider shutdown error', e));
    void loggerProvider?.shutdown().catch((e) => diag('logger provider shutdown error', e));
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

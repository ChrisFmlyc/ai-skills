// ── Error recording + last-gasp flush — oteltrace reference, TypeScript ──
//
// Errors are not a fourth signal. They land on the three you already have, and
// OTEL-STANDARD.md decides which:
//
//   * An exception thrown INSIDE an operation is a moment inside that operation,
//     so it is a SPAN EVENT plus a span STATUS — never a child span (§4, §7).
//     `span.recordException()` emits the semconv `exception` event carrying
//     `exception.type` / `exception.message` / `exception.stacktrace`.
//   * The narrative ("what were we doing, for whom, with what inputs") is a LOG,
//     emitted through the same OTel pipeline and therefore trace-correlated (§5).
//   * "How many failures" is a METRIC (§8) — see gating.ts's `job.cycles{outcome}`.
//     Do not count errors by scanning logs.
//
// A failed CHECK is still a check: it belongs in the log, not in a trace (§4).
// That log will have no trace id, and that is correct as designed.
//
// THE FLUSH IS THE LOAD-BEARING PART. Batch processors buffer, so a process that
// dies takes the telemetry describing its own death with it — you lose exactly
// the records you needed. Every exit path must flush: crash, rejection, SIGTERM,
// SIGINT. Flush with a TIMEOUT, so a hung exporter can't wedge shutdown, and
// preserve the exit code so orchestrators still see a failure as a failure.
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { logger } from './logger.js';
import { shutdownTelemetry } from './telemetry.js';

/**
 * Record an error on a span: semconv `exception` event + ERROR status. Call this
 * where the error is HANDLED (the boundary that knows what failed), not at every
 * frame it passes through — one operation, one status.
 *
 * `escaped: true` marks an exception that terminated the operation, per semconv.
 */
export function recordError(span: Span | undefined, err: unknown, escaped = true): void {
  const error = err instanceof Error ? err : new Error(String(err));
  const target = span ?? trace.getActiveSpan();
  if (!target) return; // No span (e.g. a suppressed check) — the LOG is the record.
  try {
    target.recordException(error);
    target.setAttribute('exception.escaped', escaped);
    target.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  } catch {
    /* error recording must never throw over the top of the real error */
  }
}

/** Log + record in one call at a handling boundary. Attributes, not interpolation (§0). */
export function reportError(err: unknown, fields: Record<string, unknown> = {}): void {
  recordError(undefined, err);
  logger.error({ ...fields, err }, 'operation failed');
}

// ── Last-gasp flush ─────────────────────────────────────────────────────────

const FLUSH_TIMEOUT_MS = 5_000;

/** Flush telemetry, but never let a stuck exporter hold the process open. */
async function flushWithTimeout(): Promise<void> {
  await Promise.race([
    shutdownTelemetry(),
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, FLUSH_TIMEOUT_MS);
      // Don't let the timer itself keep the event loop alive.
      if (typeof t.unref === 'function') t.unref();
    }),
  ]);
}

/**
 * Wire the process-level exits. Call ONCE at the entrypoint, straight after
 * initTelemetry(). Idempotent — a second call is a no-op, because the repeat path
 * is what every restart after the first takes (§10) and double-registering here
 * would double-flush.
 *
 * `onShutdown` is where the app closes its own things (server, worker, pool)
 * BEFORE telemetry goes away — otherwise the shutdown path itself emits into a
 * dead pipeline.
 */
let installed = false;

export function installProcessErrorHandlers(onShutdown?: () => Promise<void>): void {
  if (installed) return;
  installed = true;

  const finish = async (code: number): Promise<void> => {
    try {
      await onShutdown?.();
    } catch (err) {
      logger.error({ err }, 'shutdown hook failed');
    }
    await flushWithTimeout();
    process.exit(code);
  };

  process.on('uncaughtException', (err) => {
    // Log FIRST — if the flush hangs or the exporter is down, the console
    // exporter on the same provider has still printed it (§0).
    reportError(err, { fatal: true, source: 'uncaughtException' });
    void finish(1);
  });

  process.on('unhandledRejection', (reason) => {
    reportError(reason, { fatal: true, source: 'unhandledRejection' });
    void finish(1);
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.info({ signal }, 'shutting down');
      void finish(0); // a clean stop is not a failure — keep the exit code honest
    });
  }
}

// ── PostHog Error Tracking (optional, and a DIFFERENT signal) ───────────────
//
// PostHog's Error Tracking product does not read OTLP spans or logs: it ingests
// `$exception` EVENTS captured by a PostHog SDK (`captureException` /
// `capture_exception`). So the above gives you errors on the trace and in the
// logs, but it does NOT create Error Tracking issues.
//
// If the human wants issues, alerting and stack-frame grouping, add the PostHog
// SDK call at the same handling boundary — the same `phc_` key, no second
// project. posthog-python stamps trace and span ids onto the exception when it is
// captured inside an active span, so Error Tracking links back to the trace;
// confirm your language's SDK does the same before promising that link.
//
//   catch (err) {
//     reportError(err, { orderId })          // span event + status + log
//     posthog.captureException(err, distinctId, { order_id: orderId })  // optional
//   }
//
// Ask before adding it: it is a second dependency and a product decision, not an
// OpenTelemetry one.

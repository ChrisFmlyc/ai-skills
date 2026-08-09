// ── Span gating + suppression — oteltrace reference, TypeScript ──
//
// OTEL-STANDARD.md §1–§3, made concrete. Only emit a span for something that
// HAPPENED; looking is not happening. That means:
//
//   run starts
//     → read candidates          (suppressed)
//     → decide per candidate     (suppressed, incl. status lookups)
//     → nothing actionable? → increment counter, log, RETURN — no span
//     → otherwise            → open span, act
//
// Three load-bearing details this file exists to enforce:
//
//   1. The COUNTER COMES FIRST. Once the empty case emits no span, "no span" and
//      "the process is dead" are the same observation. `recordCycle()` runs on
//      EVERY cycle regardless of outcome, and you alert on its ABSENCE. Build it
//      before you make the span conditional, not after (§1).
//   2. Suppression is a PRIVATE CONTEXT KEY, never baggage — baggage travels in
//      plaintext headers to every downstream service (§3).
//   3. The check runs OUTSIDE the span, so nothing is allocated for a no-op and
//      no filter config can drift out of agreement with the code (§1). The
//      lookup's duration falls outside the span; that is correct — it is a check,
//      not the work.
//
// Suppressing the span must NEVER suppress the LOG (§4): for an empty run the log
// is the only evidence the code executed, and a log with no trace id emitted by a
// suppressed check is correct as designed.
import { context, createContextKey, metrics, trace, type Context, type Span } from '@opentelemetry/api';
import { logger } from './logger.js';

// ── 1. Liveness counter (build this FIRST) ──────────────────────────────────

const METER_NAME = 'app';

/** Bounded outcome set — a metric label is a time series, so never let a
 *  producer-controlled value in here without an `other` catch-all (§7). */
export type CycleOutcome = 'acted' | 'nothing_to_do' | 'error';

/**
 * Increment once per cycle, on EVERY path. Alert on the ABSENCE of this counter,
 * not on the absence of spans. Resolved lazily so it degrades to the API no-op
 * before the meter provider registers (fail-soft).
 */
export function recordCycle(job: string, outcome: CycleOutcome): void {
  try {
    metrics
      .getMeter(METER_NAME)
      .createCounter('job.cycles', { description: 'Job cycles run, whatever the outcome' })
      .add(1, { job, outcome });
  } catch {
    /* liveness accounting must never throw into the job (fail-soft) */
  }
}

// ── 2. Suppression (private context key — NOT baggage) ──────────────────────

const SUPPRESS_KEY = createContextKey('app.telemetry.suppress');

/** True when the current context is inside a suppressed region. */
export function isSuppressed(ctx: Context = context.active()): boolean {
  return ctx.getValue(SUPPRESS_KEY) === true;
}

/**
 * Run `fn` with tracing suppressed. Remove the SPAN, not the call — the poll
 * still happens; only its span goes. Route every suppressible call through one
 * helper like this so suppression cannot be half-applied.
 *
 * Where a client's transport fixes instrumentation at construction, hold two
 * clients (traced / plain) and select on `isSuppressed()` instead.
 */
export function withSuppressedTracing<T>(fn: () => T): T {
  return context.with(context.active().setValue(SUPPRESS_KEY, true), fn);
}

// ── 3. Check first, then open the span ──────────────────────────────────────

export interface GatedRunOptions<W> {
  /** Job name for the counter + logs. */
  job: string;
  /** Span name opened only when there IS work. */
  spanName: string;
  /**
   * Decide whether this run will ACT. Runs with spans suppressed, including any
   * network call it makes. Return the work, or undefined/[] for "nothing to do".
   *
   * Gate on whether this run will act, NOT on whether there are any records — a
   * long-lived pending record makes "are there records?" permanently true, and a
   * job gated that way traces every run forever while doing nothing (§1).
   */
  decide: () => Promise<W | undefined>;
  /** The work. Runs inside the root span. */
  act: (work: W, span: Span) => Promise<void>;
}

/**
 * One trace per unit of work, opened only when there is work — the shape §1 and
 * §2 ask for. Returns true when it acted.
 */
export async function runGated<W>({ job, spanName, decide, act }: GatedRunOptions<W>): Promise<boolean> {
  let work: W | undefined;
  try {
    // The check — outside any span, and suppressed so its own IO emits nothing.
    work = await withSuppressedTracing(() => decide());
  } catch (err) {
    recordCycle(job, 'error');
    // The log survives with no span, and that is the point: it is the only
    // evidence this cycle ran. A failed check belongs in the log, not a trace.
    logger.error({ job, err }, 'gate check failed');
    return false;
  }

  const empty = work === undefined || (Array.isArray(work) && work.length === 0);
  if (empty) {
    recordCycle(job, 'nothing_to_do');
    logger.info({ job, outcome: 'nothing_to_do' }, 'nothing to do');
    return false; // ← no span. Deliberate.
  }

  // Something is going to HAPPEN — now open the root span.
  const tracer = trace.getTracer(METER_NAME);
  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      await act(work as W, span);
      span.setStatus({ code: 1 }); // SpanStatusCode.OK — not an HTTP status (§7)
      recordCycle(job, 'acted');
      return true;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: 2 }); // SpanStatusCode.ERROR
      recordCycle(job, 'error');
      logger.error({ job, err }, 'work failed');
      return false;
    } finally {
      span.end();
    }
  });
}

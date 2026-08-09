// ── Redaction (oteltrace reference, TypeScript) — OTEL-STANDARD.md §9 ──
//
// Logs AND span attributes leave the box to a third party (PostHog), and a
// brownfield migration starts exporting whatever existing statements already
// carry. §9 is explicit that these are TWO pipelines with different code paths:
// the log pipeline having redaction says NOTHING about the trace pipeline.
// Auto-instrumentation has not read your rules — hand-written spans behave while
// the HTTP client records the request target verbatim, and a capability URL *is*
// the credential.
//
// So this file ships both halves:
//   * RedactionLogRecordProcessor — LogRecordProcessor, installed on the
//     LoggerProvider BEFORE the OTLP batch processor (processors run in order).
//   * RedactingSpanExporter      — wraps the OTLP span exporter and redacts the
//     EXPORTED COPY of each span. Note it builds a new object rather than
//     mutating an ended span's attribute map behind the SDK's back (§9: an ended
//     span is read-only; mutating it may reach the exporter today and quietly
//     stop working on an upgrade).
//   * sanitizeUrl               — the URL scrubber, exported on its own so it can
//     be used at the CALL SITE / in an instrumentation hook, which is where §9
//     wants derivation to happen. The exporter wrapper is the backstop, not the
//     plan.
//
// The key matching is intentionally a denylist of KEY names (case-insensitive
// substring), not a value-pattern scanner: pattern scanning every log body is
// expensive and lossy. The migration step (skill Step 8) additionally FLAGS
// suspected-sensitive call sites for human review.
//
// Adapt the default denylist per project; keep it conservative (over-redact
// rather than leak).
import type { LogRecord, LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ExportResult } from '@opentelemetry/core';

const DEFAULT_DENYLIST = [
  'authorization',
  'token',
  'password',
  'passwd',
  'secret',
  'apikey',
  'api_key',
  'cookie',
  'set-cookie',
  'session',
  'email',
  'phone',
  'ssn',
  'credit',
  'card',
  'cvv',
  'private',
] as const;

const REDACTED = '[REDACTED]';

/** True when `key` contains any denylisted term (case-insensitive substring). */
function isSensitive(key: string, denylist: readonly string[]): boolean {
  const k = key.toLowerCase();
  return denylist.some((term) => k.includes(term));
}

/**
 * A LogRecordProcessor that redacts sensitive attribute values in place before
 * the record is handed to downstream processors/exporters. Pass a custom
 * `denylist` to extend/replace the defaults.
 */
export class RedactionLogRecordProcessor implements LogRecordProcessor {
  private readonly denylist: readonly string[];

  constructor(denylist: readonly string[] = DEFAULT_DENYLIST) {
    // Lower-case once; matching is case-insensitive.
    this.denylist = denylist.map((d) => d.toLowerCase());
  }

  onEmit(record: LogRecord): void {
    const attrs = record.attributes;
    if (!attrs) return;
    for (const key of Object.keys(attrs)) {
      if (isSensitive(key, this.denylist)) {
        // setAttribute is the public mutation path; falls back to direct assign.
        if (typeof (record as { setAttribute?: unknown }).setAttribute === 'function') {
          (record as unknown as { setAttribute: (k: string, v: unknown) => void }).setAttribute(
            key,
            REDACTED,
          );
        } else {
          (attrs as Record<string, unknown>)[key] = REDACTED;
        }
      }
    }
  }

  // No async work to flush/shut down — redaction is synchronous and in-place.
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/** Convenience factory mirroring the other reference helpers. */
export function makeRedactionProcessor(
  denylist?: readonly string[],
): RedactionLogRecordProcessor {
  return new RedactionLogRecordProcessor(denylist);
}

// ── Span pipeline ───────────────────────────────────────────────────────────
//
// §9: cover EVERY attribute name the value might land on. Which one is populated
// depends on the instrumentation's version and on stable-vs-legacy semantic
// conventions, so covering the obvious one still ships a credential.
const URL_ATTRS = [
  'url.full',
  'url.original',
  'url.path',
  'url.query',
  'http.url',
  'http.target',
  'http.route',
  'db.connection_string',
  'server.address',
] as const;

/** JWTs, long hex digests, long base64url blobs. NOT uuids — those are entity
 *  ids, and high cardinality on a span is the point (§7). */
const TOKEN_SHAPED =
  /^(?:[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[0-9a-f]{32,}|[A-Za-z0-9_-]{32,})$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Scrub a URL (absolute or path-relative) while PRESERVING the non-secret parts,
 * so the span still says what happened (§9). Removes userinfo, redacts
 * denylisted query-param values, and redacts token-shaped path segments — the
 * capability-URL case, where the path itself is the credential.
 *
 * Use this at the call site or in an instrumentation hook wherever you can; the
 * exporter wrapper below applies it as a backstop.
 */
export function sanitizeUrl(value: string, denylist: readonly string[] = DEFAULT_DENYLIST): string {
  // Route templates ("/orders/{id}") carry nothing secret and must survive intact.
  if (!value.includes('/') && !value.includes('?')) return value;

  const relative = !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  let url: URL;
  try {
    url = new URL(value, relative ? 'http://redaction.invalid' : undefined);
  } catch {
    // Unparseable — fail closed rather than exporting an unknown string.
    return REDACTED;
  }

  // user:pass@host is always a credential.
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
  }

  for (const [key, param] of [...url.searchParams.entries()]) {
    if (isSensitive(key, denylist) || (!UUID.test(param) && TOKEN_SHAPED.test(param))) {
      url.searchParams.set(key, REDACTED);
    }
  }

  url.pathname = url.pathname
    .split('/')
    .map((seg) => (!UUID.test(seg) && TOKEN_SHAPED.test(seg) ? REDACTED : seg))
    .join('/');

  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

/** Redact one attribute map (span or event); returns a NEW object. */
function redactAttributes(
  attrs: Readonly<Record<string, unknown>>,
  denylist: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (isSensitive(key, denylist)) {
      out[key] = REDACTED;
    } else if (typeof value === 'string' && (URL_ATTRS as readonly string[]).includes(key)) {
      out[key] = sanitizeUrl(value, denylist);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Wraps a SpanExporter and redacts the exported copy of every span — the trace-
 * pipeline half of §9. Install it around the OTLP trace exporter:
 *
 *   new BatchSpanProcessor(new RedactingSpanExporter(new OTLPTraceExporter(...)))
 *
 * Copies rather than mutates: an ended span is read-only, and rewriting its
 * attribute map in place is the upgrade-fragile pattern §9 warns about.
 */
export class RedactingSpanExporter implements SpanExporter {
  private readonly denylist: readonly string[];

  constructor(
    private readonly inner: SpanExporter,
    denylist: readonly string[] = DEFAULT_DENYLIST,
  ) {
    this.denylist = denylist.map((d) => d.toLowerCase());
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(
      spans.map((span) => this.redact(span)),
      resultCallback,
    );
  }

  private redact(span: ReadableSpan): ReadableSpan {
    const attributes = redactAttributes(
      span.attributes as Record<string, unknown>,
      this.denylist,
    );
    const events = span.events.map((event) =>
      event.attributes
        ? { ...event, attributes: redactAttributes(event.attributes as Record<string, unknown>, this.denylist) }
        : event,
    );
    // Prototype-preserving shallow copy: ReadableSpan exposes getters, and the
    // OTLP transform reads them.
    return Object.create(Object.getPrototypeOf(span) as object, {
      ...Object.getOwnPropertyDescriptors(span),
      attributes: { value: attributes, enumerable: true },
      events: { value: events, enumerable: true },
    }) as ReadableSpan;
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

/** Convenience factory mirroring the other reference helpers. */
export function makeRedactingSpanExporter(
  inner: SpanExporter,
  denylist?: readonly string[],
): RedactingSpanExporter {
  return new RedactingSpanExporter(inner, denylist);
}

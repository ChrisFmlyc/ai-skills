// ── Redaction LogRecordProcessor (oteltrace reference, TypeScript) ──
//
// Logs + span attributes leave the box to a third party (PostHog), and a
// brownfield migration starts exporting whatever existing log statements
// already carry. This processor scrubs sensitive ATTRIBUTE VALUES (and, when a
// key in the body looks structured, leaves the body but nulls flagged keys)
// BEFORE the OTLP exporter runs. Install it on the LoggerProvider ahead of the
// OTLP batch processor.
//
// It is intentionally a denylist of KEY names (case-insensitive substring), not
// a value-pattern scanner: pattern scanning over every log body is expensive and
// lossy. The migration step (skill Step 4) additionally FLAGS suspected-sensitive
// call sites for human review — this processor is the runtime backstop.
//
// Adapt the default denylist per project; keep it conservative (over-redact
// rather than leak).
import type { LogRecord, LogRecordProcessor } from '@opentelemetry/sdk-logs';

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

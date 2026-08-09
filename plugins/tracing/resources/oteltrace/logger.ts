// ── Central structured logger (native OTEL Logs API) — oteltrace reference ──
//
// Every call emits a NATIVE OTEL LogRecord through the global LoggerProvider that
// telemetry.ts registers. That provider ALWAYS carries a console exporter (stdout)
// and — when PostHog export is enabled — the OTLP→PostHog exporter. Console is an
// exporter on that one provider, never a second `stdout.write` path (§0).
//
// OTEL-STANDARD.md §0 accepts either route into the logs SDK: bridge the language's
// normal logging API, or emit through the logs API directly. This reference emits
// directly because the pino→OTEL bridge silently dropped EVERY record under pure
// ESM. If you bridge instead, verify records actually arrive in your runtime first.
//
// Trace correlation is AUTOMATIC: emit() captures the active span context, so a log
// emitted inside a span carries that span's trace/span ids. Never inject by hand.
//
// LAZY RESOLUTION: the underlying logger is resolved at CALL time via
// logs.getLogger(...) — never cached at module load (that would pin the no-op
// logger that exists before the provider registers). No provider yet → no-op →
// clean fail-soft (never throws).
import { logs, SeverityNumber, type LogAttributes } from '@opentelemetry/api-logs';
import { postHogAttributes } from './posthog-context.js';

const LOGGER_NAME = 'app';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVELS: Record<Level, { priority: number; severityNumber: SeverityNumber; severityText: string }> = {
  trace: { priority: 10, severityNumber: SeverityNumber.TRACE, severityText: 'TRACE' },
  debug: { priority: 20, severityNumber: SeverityNumber.DEBUG, severityText: 'DEBUG' },
  info: { priority: 30, severityNumber: SeverityNumber.INFO, severityText: 'INFO' },
  warn: { priority: 40, severityNumber: SeverityNumber.WARN, severityText: 'WARN' },
  error: { priority: 50, severityNumber: SeverityNumber.ERROR, severityText: 'ERROR' },
  fatal: { priority: 60, severityNumber: SeverityNumber.FATAL, severityText: 'FATAL' },
};

type Fields = Record<string, unknown>;

/** Min level priority from env (OTEL_LOG_LEVEL); resolved per call. `silent` suppresses all. */
function resolveMinPriority(): number {
  const level = (process.env.OTEL_LOG_LEVEL ?? '').trim().toLowerCase();
  if (level === 'silent') return Number.POSITIVE_INFINITY;
  return LEVELS[level as Level]?.priority ?? LEVELS.info.priority;
}

/** Normalise (objOrMsg, msg?) into a body string + attributes, lifting Error fields. */
function normalise(objOrMsg: unknown, msg?: string): { body: string; attributes: Fields } {
  const liftError = (prefix: string, err: Error): Fields => ({
    [`${prefix}Name`]: err.name,
    [`${prefix}Message`]: err.message,
    ...(err.stack ? { [`${prefix}Stack`]: err.stack } : {}),
  });
  if (typeof objOrMsg === 'string') return { body: objOrMsg, attributes: {} };
  if (objOrMsg instanceof Error) {
    return {
      body: msg ?? objOrMsg.message,
      attributes: {
        errorName: objOrMsg.name,
        errorMessage: objOrMsg.message,
        ...(objOrMsg.stack ? { errorStack: objOrMsg.stack } : {}),
      },
    };
  }
  if (objOrMsg !== null && typeof objOrMsg === 'object') {
    const attributes: Fields = {};
    for (const [key, value] of Object.entries(objOrMsg as Fields)) {
      if (value instanceof Error) Object.assign(attributes, liftError(key, value));
      else attributes[key] = value;
    }
    return { body: msg ?? '', attributes };
  }
  return { body: msg ?? '', attributes: {} };
}

function emit(level: Level, base: Fields, objOrMsg: unknown, msg?: string): void {
  const spec = LEVELS[level];
  if (spec.priority < resolveMinPriority()) return;
  const { body, attributes } = normalise(objOrMsg, msg);
  try {
    logs.getLogger(LOGGER_NAME).emit({
      severityNumber: spec.severityNumber,
      severityText: spec.severityText,
      body,
      // postHogAttributes() adds `posthogDistinctId` / `sessionId` from the
      // ambient context when the request carried them, so the record is
      // clickable through to the person and the session replay. Call-site
      // fields win — an explicit id beats the ambient one.
      attributes: { ...postHogAttributes(), ...base, ...attributes } as LogAttributes,
    });
  } catch {
    /* emission must never throw out of a log call (fail-soft) */
  }
}

export interface Logger {
  fatal(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  info(o: unknown, m?: string): void;
  debug(o: unknown, m?: string): void;
}

function makeLogger(base: Fields): Logger {
  return {
    fatal: (o, m) => emit('fatal', base, o, m),
    error: (o, m) => emit('error', base, o, m),
    warn: (o, m) => emit('warn', base, o, m),
    info: (o, m) => emit('info', base, o, m),
    debug: (o, m) => emit('debug', base, o, m),
  };
}

/** Process logger (no base attributes — service.name lives on the resource). */
export const logger: Logger = makeLogger({});

const childCache = new Map<string, Logger>();
/** Memoised child logger tagged with { component }. */
export function childLogger(component: string): Logger {
  let child = childCache.get(component);
  if (!child) {
    child = makeLogger({ component });
    childCache.set(component, child);
  }
  return child;
}

// ── Cross-service context + PostHog linking — oteltrace reference, TypeScript ──
//
// Two different kinds of context travel between services, and they are NOT
// alternatives — a correct hop carries both:
//
//   1. TRACE context (W3C `traceparent`), which decides whether the next hop is
//      the same trace. OTEL-STANDARD.md §6: attachment is the context, always.
//      Inject on the producer, Extract on the consumer, into a DETACHED context.
//   2. POSTHOG identity context, which decides whether the resulting logs/spans
//      are clickable through to a person and a session replay:
//        * `posthogDistinctId` — matched against every distinct_id PostHog knows
//          for that person, so any one of their identifiers links the record.
//        * `sessionId`         — links the record to the session replay.
//      `posthog-js` can inject these itself: `tracing_headers: ['api.your-app.com']`
//      adds `X-POSTHOG-SESSION-ID` and `X-POSTHOG-DISTINCT-ID` to fetch/XHR calls
//      to those hosts. Read them at your edge and carry them inward.
//
// Trace context is OPTIONAL FOREVER (§6): a request arriving without it starts a
// plain root and records that fact. NEVER reject or drop work for missing
// telemetry headers — services deploy independently.
import {
  context,
  createContextKey,
  propagation,
  ROOT_CONTEXT,
  trace,
  type Context,
  type Span,
} from '@opentelemetry/api';

/** PostHog's own header names, as injected by posthog-js `tracing_headers`. */
export const PH_SESSION_HEADER = 'x-posthog-session-id';
export const PH_DISTINCT_ID_HEADER = 'x-posthog-distinct-id';

/** The ATTRIBUTE keys PostHog matches on. These names are not ours to choose. */
export const PH_DISTINCT_ID_ATTR = 'posthogDistinctId';
export const PH_SESSION_ATTR = 'sessionId';

export interface PostHogIdentity {
  distinctId?: string;
  sessionId?: string;
}

const PH_IDENTITY_KEY = createContextKey('app.posthog.identity');

/** Identity for the current context — logger.ts merges this onto every record. */
export function currentPostHogIdentity(ctx: Context = context.active()): PostHogIdentity {
  return (ctx.getValue(PH_IDENTITY_KEY) as PostHogIdentity | undefined) ?? {};
}

/** The same identity as OTel attributes, ready to spread onto a log or span. */
export function postHogAttributes(ctx?: Context): Record<string, string> {
  const { distinctId, sessionId } = currentPostHogIdentity(ctx);
  return {
    ...(distinctId ? { [PH_DISTINCT_ID_ATTR]: distinctId } : {}),
    ...(sessionId ? { [PH_SESSION_ATTR]: sessionId } : {}),
  };
}

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Read an inbound request's context.
 *
 * Extracts the trace context into a DETACHED context (ROOT_CONTEXT), never onto
 * the live one — extracting onto the live context silently makes the remote span
 * your parent before you have decided whether it should be (§6).
 */
export function extractIncoming(headers: Headers): {
  remote: Context;
  identity: PostHogIdentity;
  tracePresent: boolean;
} {
  const remote = propagation.extract(ROOT_CONTEXT, headers);
  const remoteSpanContext = trace.getSpanContext(remote);
  return {
    remote,
    identity: {
      distinctId: header(headers, PH_DISTINCT_ID_HEADER),
      sessionId: header(headers, PH_SESSION_HEADER),
    },
    tracePresent: Boolean(remoteSpanContext?.traceId),
  };
}

/**
 * Run `fn` with the inbound identity attached, and with the remote span context
 * GRAFTED onto the LIVE context when continuing.
 *
 * Grafting, not adopting: the extracted context was built from ROOT_CONTEXT and
 * carries no deadline or cancellation, so handing it straight to the handler
 * makes the work un-cancellable on shutdown (§6).
 */
export function withIncoming<T>(
  { remote, identity }: { remote: Context; identity: PostHogIdentity },
  fn: () => T,
  continueTrace = true,
): T {
  let ctx = context.active().setValue(PH_IDENTITY_KEY, identity);
  const remoteSpanContext = trace.getSpanContext(remote);
  if (continueTrace && remoteSpanContext) {
    ctx = trace.setSpanContext(ctx, remoteSpanContext);
  }
  return context.with(ctx, fn);
}

/** Stamp the identity onto a span so the TRACE is clickable to person/replay too. */
export function stampPostHogIdentity(span: Span, ctx?: Context): void {
  for (const [key, value] of Object.entries(postHogAttributes(ctx))) {
    span.setAttribute(key, value);
  }
}

/**
 * Headers for an outbound call: W3C `traceparent` (so the next hop can continue
 * the trace) plus the PostHog identity (so its logs land on the same person and
 * session). Call INSIDE the span whose context should propagate.
 */
export function injectOutgoing(headers: Headers = {}): Headers {
  propagation.inject(context.active(), headers);
  const { distinctId, sessionId } = currentPostHogIdentity();
  if (distinctId) headers[PH_DISTINCT_ID_HEADER] = distinctId;
  if (sessionId) headers[PH_SESSION_HEADER] = sessionId;
  return headers;
}

/**
 * Record on the root span whether trace context was present (§6). Do this rather
 * than dropping the request: a plain root that says `trace_context.present=false`
 * is the correct outcome, and the reason the next deploy can be diagnosed.
 */
export function recordTracePresence(span: Span, present: boolean): void {
  span.setAttribute('trace_context.present', present);
}

// A flow-level correlation id in BAGGAGE, stamped on every span as an attribute,
// stays constant whether a hop continued the trace or started a new root + link —
// so one query spans both shapes (§6). Filter baggage to that ONE key: baggage
// goes in plaintext headers to every downstream service, and a permissive filter
// is an exfiltration path.
export const FLOW_ID_BAGGAGE_KEY = 'app.flow_id';

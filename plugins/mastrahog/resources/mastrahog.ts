/**
 * mastrahog — drop-in native PostHog AI tracing for Mastra.
 *
 * This is the "master code": copy it into your Mastra project (e.g. src/) and
 * pass `buildPostHogObservability()` to your `Mastra` instance. That single
 * wiring turns on PostHog's native AI-tracing connector (@mastra/posthog).
 *
 * WHAT YOU GET (automatically, once wired):
 *   • $ai_trace / $ai_generation / $ai_span events under PostHog → AI engineering
 *   • token counts, cost, latency, model + provider — per generation, no extra code
 *   • per-user + per-session attribution → see withUser() / withSession()
 *   • failed generations flagged on the trace ($ai_is_error / $ai_error) — just let
 *     the error propagate (or rethrow after handling)
 *   • live Evaluations (LLM-as-judge) attach to these generations once you enable
 *     them in PostHog (UI: AI engineering → Evaluations) — server-side + sampled,
 *     no code change here
 *
 * KNOWN LIMITATION (as of @mastra/posthog 1.1.x — be honest about this):
 *   • The exporter ships trace METADATA only, NOT the prompt/response/tool-call
 *     payloads. Consequences: PostHog's Tools tab and Sentiment stay empty, and
 *     in-trace message content is not shown. **Tool-call instrumentation is not
 *     delivered yet** — do not promise a populated Tools tab. Everything else
 *     (traces, generations, users, sessions, errors, evaluations) works.
 *
 * ENV (use your PROJECT token — starts with phc_, never a personal phx_ key):
 *   POSTHOG_PROJECT_TOKEN=phc_xxxxxxxx
 *   POSTHOG_HOST=https://eu.i.posthog.com     # or https://us.i.posthog.com / self-host
 */
import { Observability, SamplingStrategyType } from '@mastra/observability';
import { PosthogExporter } from '@mastra/posthog';

export interface PostHogTracingOptions {
  /** Logical service name attached to every trace. Defaults to "mastra-app". */
  serviceName?: string;
  /** Sampling ratio 0..1. Omit to sample EVERY trace (best for dev/low traffic). */
  sampleRate?: number;
  /** Smaller batches + faster flush for short-lived / serverless runtimes. */
  serverless?: boolean;
}

/**
 * Build the PostHog `Observability` to hand to `new Mastra({ observability })`.
 * Throws early (with a clear message) if the token is missing or is the wrong
 * kind of key — fail fast beats silent no-telemetry.
 */
export function buildPostHogObservability(opts: PostHogTracingOptions = {}): Observability {
  const apiKey = process.env.POSTHOG_PROJECT_TOKEN;
  if (!apiKey) {
    throw new Error('mastrahog: set POSTHOG_PROJECT_TOKEN (your phc_ project token) before starting Mastra.');
  }
  if (!apiKey.startsWith('phc_')) {
    throw new Error(
      'mastrahog: POSTHOG_PROJECT_TOKEN must be a PROJECT token (phc_…), not a personal API key (phx_…).',
    );
  }
  const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

  const exporter = new PosthogExporter({ apiKey, host, serverless: opts.serverless });
  const serviceName = opts.serviceName ?? 'mastra-app';

  // Each branch is contextually typed against the config's SamplingStrategy
  // union, so the enum discriminant isn't widened (which would break the union).
  return new Observability({
    configs: {
      posthog:
        opts.sampleRate === undefined
          ? { serviceName, sampling: { type: SamplingStrategyType.ALWAYS }, exporters: [exporter] }
          : {
              serviceName,
              sampling: { type: SamplingStrategyType.RATIO, probability: opts.sampleRate },
              exporters: [exporter],
            },
    },
  });
}

/** Options object for an attributed run. Spread into agent.generate / run.start. */
export interface AttributedRun {
  tracingOptions: { metadata: { userId: string; sessionId?: string } };
}

/**
 * Attribute a run to a user (and optional session). PostHog maps:
 *   metadata.userId    → person / distinct id  (AI engineering → Users)
 *   metadata.sessionId → $ai_session_id        (AI engineering → Sessions)
 *
 *   const res = await agent.generate(input, withUser('user-123'));
 *   const res = await agent.generate(input, withUser('user-123', 'session-abc'));
 *
 * For workflows: `await run.start({ inputData, ...withUser('user-123') })`.
 */
export function withUser(userId: string, sessionId?: string): AttributedRun {
  return { tracingOptions: { metadata: { userId, ...(sessionId ? { sessionId } : {}) } } };
}

/** Alias when you only care about grouping a multi-turn session. */
export function withSession(userId: string, sessionId: string): AttributedRun {
  return withUser(userId, sessionId);
}

/**
 * Read the trace id off a generate / workflow result. Useful for correlating
 * logs, user feedback, or support tickets back to the exact trace.
 *
 *   const res = await agent.generate(input);
 *   const traceId = getTraceId(res); // e.g. attach to a feedback event later
 */
export function getTraceId(result: unknown): string | undefined {
  return (result as { traceId?: string } | null | undefined)?.traceId;
}

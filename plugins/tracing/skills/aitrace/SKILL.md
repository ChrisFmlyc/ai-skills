---
name: aitrace
description: Wire native PostHog AI tracing into a Mastra (TypeScript) project and validate it end-to-end. Installs the @mastra/posthog connector, drops in the master code, attributes users/sessions, handles errors, configures sampling, notes live evaluations, and confirms $ai_* traces are actually landing in PostHog. Use when someone says "add PostHog tracing to my Mastra agent", "instrument my Mastra app for PostHog", "/tracing:aitrace", or wants LLM observability on a Mastra project.
disable-model-invocation: true
metadata:
  version: "0.1.0"
  triggers:
    - "tracing aitrace"
    - "add posthog tracing to my mastra agent"
    - "instrument my mastra app for posthog"
---

# tracing:aitrace — native PostHog AI tracing for Mastra, wired and validated

The principle: the human calls `/tracing:aitrace` and you do everything needed
to make a Mastra app emit correct PostHog AI traces — install the connector, drop
in the master code, wire it into the `Mastra` instance, set env, and then **prove
it works** by running the agent and reading the traces back from PostHog. The
human should not have to know `@mastra/posthog` internals; calling the skill is
the whole job.

Bundled master code (copy these into the project — don't reinvent them; they
encode the correct config, fail-fast checks, and helpers):
- `${CLAUDE_PLUGIN_ROOT}/resources/aitrace/mastra-posthog.ts` — `buildPostHogObservability()` + `withUser()` / `withSession()` / `getTraceId()`.
- `${CLAUDE_PLUGIN_ROOT}/resources/aitrace/validate-trace.ts` — reads traces back from PostHog to confirm ingestion (cache-busting baked in — see lessons).

## What this skill delivers (and what it does NOT)

Delivered by the native `@mastra/posthog` connector once wired:

| Concern | How it works |
|---|---|
| **Tracing (native)** | `buildPostHogObservability()` → `new Mastra({ observability })`. Emits `$ai_trace` / `$ai_generation` / `$ai_span`. |
| **Generations** | Automatic per `agent.generate` / `stream` — tokens, cost, latency, model, provider. No extra code. |
| **Users** | `agent.generate(input, withUser('user-123'))` → `metadata.userId` → PostHog person (Users tab). |
| **Sessions** | `withUser('user-123', 'session-abc')` → `metadata.sessionId` → `$ai_session_id` (Sessions). |
| **Errors** | A generation that throws is flagged **on the trace** (`$ai_is_error` / `$ai_error`) automatically — let it propagate / rethrow after handling. ⚠️ flag lands on `$ai_trace`, NOT the child `$ai_generation` (see lessons). |
| **Evaluations (live)** | LLM-as-judge, enabled in the PostHog UI (AI engineering → Evaluations). Server-side + sampled (0.1–100%); attaches `$ai_evaluation` to your generations. No code change. |

**NOT delivered — say so plainly, never fake it:**
- **Tool calling / message content.** `@mastra/posthog` (1.1.x) exports trace
  **metadata only** — NOT prompt/response/**tool-call** payloads. So PostHog's
  **Tools** tab and **Sentiment** stay empty and in-trace message content is not
  shown. This is verified and **not fixable from config** (see lessons). Do not
  wire anything claiming a populated Tools tab.

This skill is **AI tracing only**. Logs, product-analytics events, and user
feedback are deliberately out of scope — they belong to future `tracing:*`
skills (see "The tracing ecosystem" below). Don't sprawl into them here.

## Preflight — confirm before touching anything

1. **It's a Mastra TypeScript project.** `@mastra/core` in `package.json` (or a
   `new Mastra(...)`). If not, stop and say this skill targets Mastra apps.
2. **Find the Mastra instance.** Locate `new Mastra({ ... })` (commonly
   `src/mastra.ts`). You'll add `observability:` to it.
3. **Project token + region.** A PostHog **project** token (`phc_…`) and the
   matching **region host** (EU `https://eu.i.posthog.com`, US
   `https://us.i.posthog.com`, or self-host). If absent, ask the human / have
   them add to `.env`. Never hardcode in source.

If any preflight fails, stop and report which — do not partially wire it.

## Steps

### 1. Install the connector
```
npm install @mastra/observability @mastra/posthog
```
The only deps this skill adds.

### 2. Drop in the master code
Copy `${CLAUDE_PLUGIN_ROOT}/resources/aitrace/mastra-posthog.ts` into the project's source
(e.g. `src/mastra-posthog.ts`). Don't rewrite it.

### 3. Wire it into the Mastra instance
```ts
import { buildPostHogObservability } from './mastra-posthog';

export const mastra = new Mastra({
  agents: { /* … */ },
  workflows: { /* … */ },
  observability: buildPostHogObservability({ serviceName: '<app-name>' }),
});
```
If an `observability` already exists, **integrate** (add the PostHog exporter
alongside) — don't clobber. Ask the human if it's non-trivial.

### 4. Set env (don't commit secrets)
```
POSTHOG_PROJECT_TOKEN=phc_…              # PROJECT token, never a personal phx_ key
POSTHOG_HOST=https://eu.i.posthog.com    # MUST match your project's region
```
Add to `.env.example` if present; confirm `.env` is gitignored.

### 5. Attribute users / sessions (recommended)
```ts
import { withUser, getTraceId } from './mastra-posthog';
const res = await agent.generate(input, withUser(userId, sessionId));
const traceId = getTraceId(res); // keep if you'll correlate feedback/logs later
// Workflows: await run.start({ inputData, ...withUser(userId, sessionId) });
```
Without this, traces are `anonymous`.

### 6. Errors & evaluations
- **Errors:** let agent failures propagate (or rethrow after handling) so the
  connector marks the trace `$ai_is_error`. Never swallow — that hides them.
- **Evaluations:** tell the human they're enabled in PostHog's UI (AI
  engineering → Evaluations): pick a sample rate + judge prompt; `$ai_evaluation`
  then attaches to the generations you're now emitting. No code.

### 7. VALIDATE — mandatory; not done until traces land
1. **Typecheck/build** so the wiring compiles (`npm run typecheck` / `tsc --noEmit`). Fix type errors.
2. **Emit a trace:** run the agent once for real, ensuring the process flushes
   (`await mastra.shutdown()` on short-lived scripts — see lessons).
3. **Read it back:**
   ```
   POSTHOG_PERSONAL_API_KEY=phx_… POSTHOG_PROJECT_ID=<id> \
     npx tsx ${CLAUDE_PLUGIN_ROOT}/resources/aitrace/validate-trace.ts
   ```
   PASS = `$ai_generation` events found. FAIL prints the likely cause.
4. **Prefer the PostHog MCP if connected** (see below) to confirm ingestion
   instead of the REST script. If neither a personal key nor the MCP is
   available, say so and tell the human to check **AI engineering → Traces** —
   don't claim success you didn't verify.

Report: what you wired, validator PASS/FAIL, and the honest caveat
(Tools/Sentiment/message-content not populated — connector limitation).

## Configuration reference

`buildPostHogObservability(opts)`:
- `serviceName?` — label on every trace (default `mastra-app`).
- `sampleRate?` — `0..1`. Omit ⇒ sample **every** trace (best for dev/low traffic). Set e.g. `0.1` in high-traffic prod.
- `serverless?` — smaller batches + faster flush for short-lived/serverless runtimes.

Per-call `tracingOptions` (second arg to `agent.generate` / `run.start`) — beyond
`withUser`, Mastra also supports:
- `metadata` — arbitrary custom attributes (userId/sessionId are special-cased by PostHog; everything else rides as trace metadata).
- `tags` — string labels for filtering traces.
- `hideInput` / `hideOutput` — exclude payloads from export (privacy). Note: with this connector message content isn't exported anyway.
- `requestContextKeys` — auto-extract keys from a Mastra `RequestContext` as metadata (e.g. set `requestContextKeys: ['userId']` at config level and pass a `RequestContext` instead of calling `withUser` everywhere).
- `traceId` / `parentSpanId` — attach Mastra spans to an external distributed trace.

Mastra-instance level: set `environment: 'production'` on `new Mastra(...)` to tag
all signals with the deploy environment.

## PostHog MCP & where the docs are

- **A PostHog MCP server may be connected** (tools named `mcp__posthog__*`). Use
  it to run HogQL, inspect insights/dashboards, and debug ingestion rather than
  hand-rolling REST calls. Auth is **interactive**: call
  `mcp__posthog__authenticate`, then `mcp__posthog__complete_authentication`. In
  headless/cron runs the MCP is often **unavailable** — fall back to the REST
  read-back (`validate-trace.ts`, personal `phx_` key), which needs no auth flow.
- **Docs:**
  - Mastra → PostHog exporter: https://mastra.ai/docs/observability/integrations/exporters/posthog and https://posthog.com/docs/ai-observability/installation/mastra
  - Mastra tracing (sampling, metadata, tags, hideInput/Output, requestContextKeys): https://mastra.ai/docs/observability/tracing
  - PostHog LLM analytics (traces, generations, users, sessions, errors, tools, sentiment, evaluations, trace-reviews): https://posthog.com/docs/llm-analytics
  - Tool-call / content gap tracking issue: https://github.com/mastra-ai/mastra/issues/14135

## Lessons learned (read this — it will save you hours)

These came from real debugging. Don't relearn them.

1. **Metadata-only — the connector does not export message/tool content.** No
   `$ai_input`, `$ai_output_choices`, `$ai_input_state`, `$ai_output_state` reach
   PostHog. Consequence: empty **Tools** tab, empty **Sentiment**, no prompt/
   response text in the trace view. Verified end-to-end: the content **is** on the
   spans right up to the exporter, then stripped in its serialize step.
   `customSpanFormatter` mutations **do not survive**, and `sensitiveDataFilter:
   false` has **no effect**. It is *not* fixable from your config. Don't promise
   it; don't burn time trying. (Refs: mastra-ai/mastra #14135, PR #14383.)
2. **Errors flag the TRACE, not the generation.** `$ai_trace.$ai_is_error = true`
   + `$ai_error = {message}`; the child `$ai_generation` often shows
   `is_error=false`. Look at the trace.
3. **Region mismatch = silent data loss.** If `POSTHOG_HOST`'s region (eu/us)
   ≠ the project's region, events vanish with **no error**. Match them first.
4. **Flush on exit.** Short-lived processes drop their batch unless they
   `await mastra.shutdown()` (and `posthog.shutdown()` if you also use
   posthog-node). Long-running servers flush on interval.
5. **HogQL `IS NOT NULL` on JSON props lies.** `WHERE properties.$x IS NOT NULL`
   returned false-empty for props that were actually present (e.g. `$ai_session_id`).
   Verify with a direct `SELECT`, `!= ''`, or the events API — not `IS NOT NULL`.
6. **The query API caches by query text.** Re-running the same validation query
   returns a stale cached result (a false negative right after you emit a trace).
   Always send `refresh: 'force_blocking'` — already baked into `validate-trace.ts`.
7. **Read-back uses different creds + host than sending.** Send: `phc_` project
   token → ingestion host `eu.i.posthog.com`. Read: `phx_` personal key + project
   id → **app** host `eu.posthog.com` (no `.i.`). `validate-trace.ts` derives the
   app host for you.
8. **Ingestion lag is normal.** Events take seconds to ~a minute to be queryable;
   the validator uses a 30-minute window so a fresh trace still counts.

## Forbidden / guardrails

- **Never** put the `phc_` token in committed source. Env only.
- **Never** claim the Tools tab, Sentiment, or in-trace message content work —
  they don't with this connector. Honesty over a clean-looking demo.
- **Never** silently `catch` and drop agent errors — that hides them from the
  Errors view, defeating the point.
- **Don't** create a second PostHog client/exporter if one exists — extend.
- **Don't** expand into logs / analytics events / feedback here — out of scope.

## The tracing ecosystem (so you know the boundaries)

`aitrace` is the first skill. Others will follow as separate `tracing:*` skills
— do **not** fold them into `aitrace`:
- **logs** — PostHog Logs via OpenTelemetry OTLP (`<host>/i/v1/logs`). Separate
  pipeline from tracing; not the Mastra connector.
- **analytics** — custom product events via `posthog-node` (e.g. lifecycle/business events).
- **feedback** — user 👍/👎 attached to a trace via `$ai_trace_id`.

## When you're done

Wired + typechecks + validator PASS (or an explicit "verify in the UI/MCP" if no
read path). The human can now see traces, generations, users, sessions, errors,
and (once enabled) evaluations in PostHog — with the tool-calling/content gap
clearly flagged.

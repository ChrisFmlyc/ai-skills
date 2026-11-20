---
name: oteltrace
description: Invoke when an app in any language needs application observability — logs, distributed traces, errors and liveness metrics. It instruments the app with OpenTelemetry and exports those signals to PostHog. It never does LLM tracing (that is /tracing:aitrace), and never starts on its own, because it rewrites every logging call in the project; type /tracing:oteltrace to run it.
disable-model-invocation: true
metadata:
  version: "0.4.0"
---

# tracing:oteltrace — OpenTelemetry logs + distributed traces for PostHog

The human calls `/tracing:oteltrace` and you do everything needed to make a project
emit **OpenTelemetry logs and distributed traces to PostHog**, to the standard below:
detect the language, stand up a fail-soft telemetry bootstrap, migrate existing logging
into the OTel SDK, open traces **at the real trigger**, keep the noise out, redact,
document the env vars, and then **prove it works** by running a bundled trace test and
reading the data back from PostHog. The human should not have to know the OTel SDK
internals; calling the skill is the whole job.

**This skill is language-agnostic.** It encodes the *general logic*; for the target
project you **detect the language and look up that language's OTel SDK + logging
idioms** before applying it. PostHog's OTLP ingestion is identical across every
language — the per-language work is idiom translation, not a different design. The
bundled TypeScript code under `${CLAUDE_PLUGIN_ROOT}/resources/oteltrace/` is the
**worked reference example** (proven in production), not the only target.

## The standard is authoritative — read it first

**`${CLAUDE_PLUGIN_ROOT}/resources/oteltrace/OTEL-STANDARD.md` is the governing
document for every instrumentation decision in this skill.** Read it before writing
any instrumentation. Where it and anything else — this file, the bundled reference
code, an existing codebase convention — disagree, **the standard wins**; say so to the
human and follow the standard.

The steps below cite its rules by number (§0–§11) rather than restating them, so
read it first or those references mean nothing.

Bundled reference (copy + adapt into the project — don't reinvent):
`${CLAUDE_PLUGIN_ROOT}/resources/oteltrace/README.md` lists every file and what it
does.

## What this skill delivers (and what it does NOT)

| Concern | oteltrace | NOT oteltrace |
|---|---|---|
| Application **logs** → PostHog, through the OTel logs SDK | ✅ | — |
| **Distributed traces** (request / workflow / activity) → PostHog | ✅ | — |
| Always-on **console** output as an exporter on the same provider | ✅ | — |
| Migrating existing logging (any framework) into the OTel SDK | ✅ | — |
| **Error handling**: exception events + ERROR span status, error logs, failure counts, and a flush on crash/SIGTERM so the last records survive | ✅ | — |
| PostHog **Error Tracking** issues (`$exception` via the PostHog SDK — a different signal, not OTLP) | ➖ offered and wired **if the human says yes**; never assumed | — |
| **Person / session-replay linking** of logs and spans (`posthogDistinctId`, `sessionId`) | ✅ when the frontend supplies them | — |
| **Liveness / gate counters** (standard §1, §8) — mandatory wherever a span is made conditional | ✅ | — |
| Span-noise cleanup: orphans, plumbing spans, health probes | ✅ | — |
| A full business-metrics programme (dashboards, SLOs, histograms beyond liveness) | ➖ possible, but out of the default scope — offer it, don't assume it | — |
| LLM `$ai_*` tracing, token/cost, generations | ❌ → use `tracing:aitrace` | LLM observability |
| AI/LLM-provider env vars (model keys, `@mastra/posthog`) | ❌ — `aitrace` owns them | — |
| Non-PostHog OTLP backends (Honeycomb, Grafana…) | ❌ — PostHog-specific (the *standard* is portable; this skill's wiring is not) | — |

## Preflight — confirm before touching anything

- **Read `OTEL-STANDARD.md`.**
- **Detect the target language + framework** (TypeScript/Node, Go, Python, Java, …;
  Temporal? Fastify/Express? etc.).
- **Get the PostHog project API key** — prompt the human (see Step 11). This is the one
  hard-required value.
- **Read this project's conventions** — match its module/layout/style.

## Steps

### 1. Detect the language and look up its OTel SDK

Identify the language and resolve **that language's** OTel SDK + logging idioms from
authoritative docs (OTel has stable SDKs for JS/TS, Go, Python, Java, .NET, Ruby, PHP,
Rust, …). Use the `context7` MCP / official OpenTelemetry docs — **do not** rely on
memory; SDK APIs drift. For a **Temporal** worker, also resolve that SDK's Temporal
OTel interceptor mechanism. **TypeScript:** the bundled `resources/oteltrace/*` are the
proven reference; copy + adapt. **Other languages:** translate the general logic into
that SDK's idioms.

### 2. Audit before changing (standard §11)

On a **brownfield** project, do not guess at the target. Query PostHog first:

- **single-span traces** (orphan candidates) and **spans-per-trace by service**;
- which log lines carry no `trace_id` and whether that's correct (a suppressed check)
  or a dropped context (§5);
- whether any signal is arriving at all.

Then **classify each offender — action / check / plumbing**. On a greenfield project,
say so and skip to Step 3.

### 3. Stand up the fail-soft bootstrap — one SDK, all signals

Create one telemetry module that builds the OTel pipeline. TypeScript: copy
`resources/oteltrace/telemetry.ts` + `logger.ts` + `redaction.ts` and adapt the config
to the project. Requirements:

1. **Fail-soft.** A missing token / disabled flag / any init error degrades to
   **console-only** and **never throws**. Register the tracer provider **last** (a throw
   mid-setup must not leak a registered-but-abandoned provider); shut down
   partially-initialised providers on error; fall back to an **empty resource** rather
   than re-running a failing resource build.
2. **Console is an exporter, not a code path** (§0). Register the OTel library's own
   console exporter (`ConsoleLogRecordExporter` in JS, the equivalent elsewhere) on the
   *same* LoggerProvider on **every** init path (enabled / disabled / fail-soft). When
   export is enabled, add the OTLP→PostHog exporter to that same provider. Prettier
   local output is a different exporter on that provider.
3. **Set resource attributes once** — `service.name`, `service.version`,
   `deployment.environment.name` (PostHog's environment facet) and the legacy
   `deployment.environment` — on the provider, so every signal carries them and no log
   call repeats them (§0).
4. **Initialise once, at the process entrypoint**, before any consumer (logger, server,
   worker). Its own init diagnostics write **directly to stderr** — the logger isn't
   usable until this registers the global provider.
5. **Everything exports from the host process**, never from inside a sandboxed
   execution context (e.g. a Temporal workflow sandbox — use the SDK's sanctioned
   cross-boundary Sink).
6. **Install the exit handlers at the same time** (Step 9).

### 4. Logs: one pipeline, no second telemetry system

Per §0, application logging must end up in the OTel logs SDK. Either route is
compliant — pick per language and **say which you picked and why**:

- **Bridge the language's normal logging API** (§0 names the bridge per language).
  Preferred when the codebase already logs through that API everywhere and you have
  verified the bridge delivers in this runtime.
- **Emit through the OTel logs API directly** (`logger.ts`). This is the bundled
  TypeScript reference, chosen for a production-proven reason: **the pino→OTel bridge
  silently dropped every record under pure ESM.**

What is **forbidden** either way: a `print`/`console.log`/`stdout.write` path running
alongside the OTel one (§0).

Log **structured attributes, not interpolated strings** (§0), and pass the context (§5)
so every record correlates with its span.

### 5. Spans are for actions — gate them, and build the counter first

Apply §1 to every span you add or find. **Before** you make any span conditional, add
the liveness counter §1 requires and tell the human to alert on its **absence**. This is
the one place metrics are non-negotiable in this skill. TypeScript: `gating.ts` ships
`recordCycle()` + `runGated()` — the whole pattern in one call. PostHog ingests OTLP
metrics at `/i/v1/metrics` with the same `phc_` key (**alpha** — confirm it's still live
before an alert depends on it; otherwise send the counter to whatever metrics backend
the project already has).

Tell the human explicitly that **orphaned logs are correct** (§4).

### 6. Kill orphans structurally, not with filters

Apply §2 and §3 to every offender the audit found, choosing each fix in the order §11
sets.

### 7. Open the trace AT THE REAL TRIGGER — the trace-boundary advisor

**A trace only exists if a root span is opened where work is started.** Inspect how the
target's work is actually triggered, **advise the human on where a trace should start
and stop — and whether a path is even worth tracing** (§1) — then open the root there:

| Trigger shape | Where the root span must open |
|---|---|
| HTTP request (allow-listed route) | per request (server middleware / instrumentation) |
| `client.start` / RPC | the client interceptor opens the root and propagates context |
| Temporal **Schedule / cron** (server-side) | the **worker-side** workflow interceptor opens the root (no client to propagate from) |
| **Long-running loop** that does work each tick | a **fresh root span per unit of work** — the parent span is NOT a per-tick trace |
| external/gateway trigger | trace the gateway, or open a root on the receiving side |

⚠️ **The trap (real, observed in production):** a **long-running loop**, a
**Schedule/cron**, or an **external trigger** produces **logs but NO trace** — because
nothing opens a root span. Logs are span-independent and flow anyway, so the gap is
invisible until you look for the trace, and a green CI test that uses `client.start` can
hide it, because production is triggered differently. **Surface this to the human
explicitly.** For Temporal (TS) the bundled `temporal-otel.ts` wires client → workflow →
activity via the sandbox-safe `makeWorkflowExporter` Sink + a project-owned interceptor
module.

**Trace lifecycle model** (document it for the human): a trace covers **one thing being
generated, from start to completion** — one request, one workflow execution, one unit of
work. Parent/child is *containment*: the child happened **inside** the parent, and the
parent is still open while it runs. So a trace is **one per unit of work** — not one per
process startup, not one per poll, and never a status check, keep-alive, probe or
"is there anything to do" lookup (§1). Boot only *registers* providers; it opens no span.
State where the root sits and the volume implication (N units of work → N traces).

#### Passing context from one service to the next (§6)

Apply §6 at every process boundary: `Inject` / detached `Extract`, the graft when
continuing, the plain root when no context arrives, continue-or-link, and the flow-level
correlation id. TS: `posthog-context.ts` does the propagation, and also carries PostHog's
identity headers (`POSTHOG-INGESTION.md`, "Getting identity from the browser to the
backend").

### 8. Migrate existing logging into the OTel SDK — stack-agnostic

Scan the codebase for **all** existing logging in **any** framework (`console.*`, pino,
winston, bunyan, framework request loggers, hand-rolled `stdout.write`) and convert
**every** emission point to the route chosen in Step 4, **removing the originals**. Map
each call's level → OTel severity and structured fields → OTel attributes, converting
interpolated strings into attributes as you go (§0). Where a call is really a moment
*inside* an operation, it stays a log or becomes a **span event** — do not promote it to
a span (§4).

This is **agent-driven**, not a mechanical codemod — you read each call's intent and emit
the equivalent. Because you can occasionally get one wrong, it is **bounded by a safety
net**:
1. **Change report** — list every rewritten site (file, before → after, level + field mapping).
2. **Flag, don't guess** — surface genuinely ambiguous sites for human review rather than a silent rewrite.
3. **Verify** — assert **no logging call remains outside the route chosen in Step 4** AND the project still **builds + tests pass**.

### 9. Errors — status, exception events, and the last-gasp flush

Errors are not a fourth signal; they land on the three you already have. Wire all of it
(TS: `resources/oteltrace/errors.ts`):

- **On the span:** an exception thrown inside an operation is a **span event + an ERROR
  span status**, never a child span (§4, §7). `recordException` emits the semconv
  `exception` event (`exception.type` / `.message` / `.stacktrace`). Record it at the
  **handling boundary** that knows what failed, not at every frame it passes through —
  and remember span status is not an HTTP status code.
- **In the log:** the narrative (what we were doing, for whom, with what inputs) is a log
  through the same pipeline, so it is trace-correlated automatically. A failed **check**
  belongs in the log, **not** a trace (§4).
- **In metrics:** "how many failures" is a counter dimension (`outcome="error"` in
  `gating.ts`), not something you recover by scanning logs (§8).
- **Flush on every exit path — this is the load-bearing part.** Batch processors buffer,
  so a crashing process takes the telemetry describing its own crash with it. Wire
  `uncaughtException`, `unhandledRejection`, `SIGTERM` and `SIGINT` to: log first (the
  console exporter on the same provider prints even if egress is down) → run the app's
  own shutdown → flush telemetry **with a timeout** so a hung exporter can't wedge the
  process → exit preserving the code. Install once at the entrypoint; make it idempotent.

**PostHog Error Tracking is a fourth product, and OTLP does not feed it.** Verified in
PostHog's docs: Error Tracking issues come from `$exception` **events captured by a
PostHog SDK** — there is no OTLP route, on any platform. Everything above puts failures
on the trace and in the logs; it creates **zero Error Tracking issues**. Be explicit with
the human about that boundary rather than letting them assume errors "just appear".

Ask whether they want issues — grouping, fingerprints, alerting, stack traces with source
maps. It's a second dependency and a product decision, not an OpenTelemetry one. If they
do, wire the PostHog SDK alongside (same `phc_` project key, no second project):

- Install the platform SDK (`posthog-node`, `posthog-python`, …) and enable **automatic
  exception capture** where it exists; add `captureException(err, distinctId, props)` at
  the same handling boundary you already record the span status on.
- **Never** hand-roll `capture('$exception', …)` — PostHog's docs say so directly. Only
  `captureException()` produces the right shape: `$exception_list` (`type`, `value`,
  `stacktrace`, `mechanism`), `$exception_fingerprint`, `$exception_level`, and it runs
  stack-trace processing and source-map resolution. Use `addExceptionStep` for
  breadcrumb-style `$exception_steps` if the human wants the lead-up.
- **The trace link:** `posthog-python` stamps trace and span ids onto an exception
  captured **inside an active OTel span**, so the issue links back to the trace.
  **Verify the target language's SDK does the same** before promising that link — and if
  it doesn't, capture inside the span anyway and attach the ids yourself as properties.

### 10. Redact — both pipelines, separately (§9)

Apply §9 to the log pipeline and the span pipeline, auditing each separately.
TypeScript: `resources/oteltrace/redaction.ts` ships both halves, and `telemetry.ts`
registers them ahead of every exporter. During Step 8, **flag any call site that appears
to log secrets/PII** in the change report. Document the data-sensitivity posture for the
human.

### 11. Set env (don't commit secrets) + prompt for the required key

**Prompt the human for the one hard-required key**, telling them where to find it:
`POSTHOG_PROJECT_API_KEY` = PostHog → **Project Settings → Project API Key** (the `phc_`
value). Validate its format (`phc_…`) **without printing it back**. Confirm their PostHog
**region** and set `POSTHOG_HOST` only when it isn't the EU default. Write keys to a
**gitignored `.env`** (or reuse an existing env var) — **never** echo, commit, or log the
key. **Do not** prompt for AI/LLM-provider env vars — those belong to `aitrace`.

The full env-var table is in `POSTHOG-INGESTION.md` § Configuration reference.

### 12. VALIDATE — mandatory; not done until data lands

Ship the bundled self-verifying trace test into the target (TS: `validate-trace.test.ts`,
a `TestWorkflowEnvironment` in-memory-exporter test asserting the full parent span chain)
and run it — it re-proves the wiring against **this project's actual installed deps and
its real trigger path** (so a broken SDK subpath / changed OTLP path fails **here**, not
silently in prod).

Write the tests §10 requires — **one per suppression, redaction and gate you added**,
each verified by reverting the change and each checked against §10's five traps — and
§5's correlation test through the redaction stage. Prove the **error path end to end**:
throw inside a real operation and assert the span carries the `exception` event *and*
ERROR status, the log carries both ids, and the counter incremented — then kill the
process and confirm those records still arrived.

Then do an opt-in live check (`OTEL_LIVE_VERIFY=1`) that exports to real PostHog and reads
the data back. **Tests passing is not evidence the data landed — not done until both logs
and a trace are visible in PostHog.**

## Where the data lands, and how it's configured

`${CLAUDE_PLUGIN_ROOT}/resources/oteltrace/POSTHOG-INGESTION.md` has the OTLP
endpoints per signal, the attributes that make a record clickable through to a
person or a session replay, the full env-var table, and the per-language SDK
lookup. Read it when wiring the exporter (Step 3), setting env (Step 11), and
checking the data arrived (Step 12).

## Forbidden / guardrails

- Never run a second telemetry path (`print`/`console.log`/`stdout.write`) alongside the OTel SDK — console is an exporter on the same provider.
- Never emit a span for a check, a probe, or plumbing; never make a span conditional before the liveness counter exists.
- Never use a deny-list for traced routes; never put suppression state in baggage.
- Never let a span attribute or log line carry a bearer credential — audit the trace and log pipelines separately.
- Never call an exporter (or any IO/clock/random) inside a sandboxed execution context (e.g. a Temporal workflow) — export from the host process via the sanctioned Sink.
- Never echo, commit, or log the API key; only write it to a gitignored `.env` / existing env var.
- Never silently rewrite logging — always emit the change report + flag ambiguous sites + verify no residual + build green.
- Never let telemetry throw out of bootstrap — fail soft to console-only.
- Never let a process exit without flushing (crash, rejection, SIGTERM, SIGINT) — and never let the flush block shutdown without a timeout.
- Never promise PostHog Error Tracking issues from OTLP alone — that needs the PostHog SDK's `captureException`, which is opt-in.
- Never reject or drop a message because it arrived without trace context.
- Don't touch AI/LLM tracing or its env vars — that's `aitrace`.

## The tracing ecosystem (so you know the boundaries)

- **`tracing:aitrace`** — native PostHog **AI** tracing (`$ai_*`) for Mastra/LLM apps.
- **`tracing:oteltrace`** *(this skill)* — **logs, distributed traces, errors and liveness metrics** for any app, any language. Same PostHog project, different signal.

## When you're done

The project emits OTel **logs and a trace** to PostHog; existing logging is migrated (with a
change report); the trace opens at the real trigger; spans exist only for actions and every
conditional span has its liveness counter; orphans are prevented structurally; failures show
up as an exception event + ERROR status + a correlated log + a counter, and survive a crash
because every exit path flushes; both pipelines are redacted; the env vars are documented and
the `phc_` key is set safely; and the tests —
including one per suppression/redaction/gate, each verified by reverting it — pass against the
project's real deps.

Report against the standard's §11 reporting rules. Tell the human exactly what landed in
PostHog, what to alert on (counter absence), and how to lower the sampler ratio in PRD.

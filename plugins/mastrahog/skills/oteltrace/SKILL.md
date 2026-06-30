---
name: oteltrace
description: Wire native OpenTelemetry logs + distributed traces into a project and export them to PostHog, validated end-to-end. The non-AI counterpart to mastrahog:aitrace — where aitrace handles LLM $ai_* observability, oteltrace handles application logs + request/workflow traces. Language-agnostic: the skill encodes the general logic and looks up the target language's OTEL SDK per run (TypeScript is the worked reference example). Use when someone says "add PostHog logging/tracing to my app", "instrument my service for OpenTelemetry → PostHog", "/mastrahog:oteltrace", or wants logs + distributed traces (not LLM traces) in PostHog.
metadata:
  version: "0.1.0"
  triggers:
    - "mastrahog oteltrace"
    - "add posthog logging to my app"
    - "add otel tracing to my service"
    - "instrument my app for opentelemetry posthog"
    - "native otel logs and traces to posthog"
---

# mastrahog:oteltrace — native OTEL logs + distributed traces for PostHog

The principle: the human calls `/mastrahog:oteltrace` and you do everything needed
to make a project emit **native OpenTelemetry logs and distributed traces to
PostHog** — detect the language, stand up a fail-soft telemetry bootstrap, migrate
any existing logging to native OTEL, wire tracing **at the real trigger**, document
the env vars, and then **prove it works** by running a bundled trace test and
reading the data back from PostHog. The human should not have to know the OTEL SDK
internals; calling the skill is the whole job.

**This skill is language-agnostic.** It encodes the *general logic*; for the target
project you **detect the language and look up that language's OTEL SDK + logging
idioms** before applying it. PostHog's OTLP ingestion is identical across every
language — the per-language work is idiom translation, not a different design. The
bundled TypeScript code under `${CLAUDE_PLUGIN_ROOT}/resources/oteltrace/` is the
**worked reference example** (proven in production), not the only target.

Bundled reference (copy + adapt into the project — don't reinvent; they encode the
fail-soft, console-exporter, trace-at-trigger, and redaction patterns):
- `resources/oteltrace/telemetry.ts` — the fail-soft `createTelemetry()` bootstrap (always-on console exporter; native Logs API; register-tracer-last; empty-resource fallback).
- `resources/oteltrace/logger.ts` — the native OTEL Logs API logger (no logging-lib bridge).
- `resources/oteltrace/temporal-otel.ts` — Temporal client/worker OTEL interceptor wiring, incl. **open-the-trace-at-the-trigger**.
- `resources/oteltrace/redaction.ts` — the redaction `LogRecordProcessor` (denylist scrubber, runs before export).
- `resources/oteltrace/validate-trace.test.ts` — the per-reuse self-verifying trace-chain test.
- `resources/oteltrace/KNOWN-GOOD-VERSIONS.md` — pinned package versions for the TS reference.

## What this skill delivers (and what it does NOT)

| Concern | oteltrace | NOT oteltrace |
|---|---|---|
| Application **logs** → PostHog (native OTEL Logs API) | ✅ | — |
| **Distributed traces** (request / workflow / activity) → PostHog | ✅ | — |
| Always-on **console** output via OTEL `ConsoleLogRecordExporter` | ✅ | — |
| Migrate existing logging (any framework) to native OTEL | ✅ | — |
| LLM `$ai_*` tracing, token/cost, generations | ❌ → use `mastrahog:aitrace` | LLM observability |
| AI/LLM-provider env vars (model keys, `@mastra/posthog`) | ❌ — `aitrace` owns them | — |
| OTEL **metrics** | ❌ — logs + traces only | — |
| Non-PostHog OTLP backends (Honeycomb, Grafana…) | ❌ — PostHog-specific | — |

## The general logic (the bar — same in every language)

1. **One fail-soft telemetry bootstrap.** A missing token / disabled flag / any init
   error degrades to **console-only** and **never throws**. Register the tracer
   provider **last** (so a throw mid-setup can't leak a registered-but-abandoned
   provider); shut down partially-initialised providers on error; fall back to an
   **empty resource** rather than re-running a failing resource build.
2. **Console logging is always on, natively.** Register an OTEL `LoggerProvider`
   carrying a console log exporter on **every** init path (enabled / disabled /
   fail-soft). Never hand-roll a `stdout.write` tee. When export is enabled, add the
   OTLP→PostHog log exporter to the **same** provider.
3. **Logs go through the native OTEL Logs API**, not a logging-library→OTEL bridge
   (bridges silently drop records under some runtimes). Native emission auto-captures
   the active span context, so logs are **trace-correlated** with no manual id
   injection.
4. **Traces are opened at the real trigger** (see the trace-boundary advisor). A
   trace only exists if a **root span** is opened where work is *started*.
5. **Everything exports from the host process**, never from inside a sandboxed/
   restricted execution context (e.g. a Temporal workflow sandbox — use the SDK's
   sanctioned cross-boundary Sink).
6. **Redact before export.** Run a redaction processor over log bodies/attributes
   before they leave the box.

Apply this logic using the **target language's** OTEL SDK (see Step 1).

## Preflight — confirm before touching anything

- **Detect the target language + framework** (TypeScript/Node, Go, Python, Java, …;
  Temporal? Fastify/Express? etc.).
- **Get the PostHog project API key** — prompt the human (see Step 6). This is the one
  hard-required value.
- **Read this project's conventions** — match its module/layout/style.

## Steps

### 1. Detect the language and look up its OTEL SDK

Identify the language and resolve **that language's** native OTEL SDK + logging idioms
from authoritative docs (OTEL has stable SDKs for JS/TS, Go, Python, Java, .NET, Ruby,
PHP, Rust, …). Use the `context7` MCP / official OpenTelemetry docs — **do not** rely on
memory; SDK APIs drift. For a **Temporal** worker, also resolve that SDK's Temporal OTEL
interceptor mechanism. **TypeScript:** the bundled `resources/oteltrace/*` are the proven
reference; copy + adapt. **Other languages:** translate the general logic into that SDK's
idioms (the PostHog OTLP target is identical).

### 2. Stand up the fail-soft telemetry bootstrap

Create one telemetry module that builds the OTEL pipeline per the general logic above.
TypeScript: copy `resources/oteltrace/telemetry.ts` + `logger.ts` + `redaction.ts` and
adapt the config to the project. Initialise it **once**, at the process entrypoint,
**before** any consumer (logger, server, worker). Its own init diagnostics must write
**directly to stderr** (the logger isn't usable until this registers the global provider —
avoid an import-order cycle).

### 3. Wire distributed tracing AT THE REAL TRIGGER — the trace-boundary advisor

**A trace only exists if a root span is opened where work is started.** Before wiring,
**inspect how the target's work is actually triggered** and **advise the human on where a
trace should start and stop — and whether a path is even worth tracing** — then open the
root span there:

| Trigger shape | Where the root span must open |
|---|---|
| HTTP request | per request (server middleware / instrumentation) |
| `client.start` / RPC | the client interceptor opens `StartWorkflow`/root and propagates context |
| Temporal **Schedule / cron** (server-side) | the **worker-side** workflow interceptor opens the root (no client to propagate from) |
| **Long-running loop** that does work each tick | open a **fresh root span per unit of work** (e.g. per child-workflow / per iteration) — the parent span is NOT a per-tick trace |
| external/gateway trigger | trace the gateway, or open a root on the receiving side |

⚠️ **The trap (real, observed in production):** a **long-running loop**, a **Schedule/cron**,
or an **external trigger** produces **logs but NO trace** — because nothing opens a root
span. Logs are span-independent and flow anyway, so the gap is invisible until you look for
the trace. **Surface this to the human explicitly** and open the root at the real trigger.
For Temporal (TS) the bundled `temporal-otel.ts` wires client → workflow → activity via the
sandbox-safe `makeWorkflowExporter` Sink + a project-owned interceptor module; the trigger
that *starts* the workflow must carry the client interceptor (or the worker-side interceptor
must open a root when no parent context exists).

**Trace lifecycle model** (document it for the human): **one trace per unit of work** (one
workflow execution / one request) — **not** one per process startup and **not** one per
poll. Boot only *registers* providers; it opens no span. State where the root sits and the
volume implication (N units of work → N traces).

### 4. Migrate existing logging to native OTEL — stack-agnostic

Scan the codebase for **all** existing logging in **any** framework (`console.*`, pino,
winston, bunyan, framework request loggers, hand-rolled `stdout.write`) and convert **every**
emission point to the native OTEL Logs API + always-on console exporter, **removing the
originals**. Map each call's level → OTEL severity and structured fields → OTEL attributes.

This is **agent-driven**, not a mechanical codemod — you read each call's intent and emit the
equivalent. Because you can occasionally get one wrong, it is **bounded by a safety net**:
1. **Change report** — list every rewritten site (file, before → after, level + field mapping).
2. **Flag, don't guess** — surface genuinely ambiguous sites for human review rather than a silent rewrite.
3. **Verify** — assert **no residual third-party logging calls remain** AND the project still **builds + tests pass**.

### 5. Redaction — scrub before export

Logs + span attributes now leave the box to a third party (PostHog). Install the redaction
`LogRecordProcessor` (`resources/oteltrace/redaction.ts`) **before** the OTLP exporter, with a
configurable sensitive-key denylist (default: `authorization, token, password, apiKey, secret,
cookie, email`). During the Step 4 migration, **flag any call site that appears to log
secrets/PII** in the change report. Document the data-sensitivity posture for the human.

### 6. Set env (don't commit secrets) + prompt for the required key

**Prompt the human for the one hard-required key**, telling them where to find it:
`POSTHOG_PROJECT_API_KEY` = PostHog → **Project Settings → Project API Key** (the `phc_`
value). Validate its format (`phc_…`) **without printing it back**. Confirm their PostHog
**region** and set `POSTHOG_HOST` only when it isn't the EU default. Write keys to a
**gitignored `.env`** (or reuse an existing env var) — **never** echo, commit, or log the key.
The `phc_` key is a *publishable* key, so this is good hygiene, not high-stakes-secret handling.
**Do not** prompt for AI/LLM-provider env vars — those belong to `aitrace`.

See the configuration reference below for the full table.

### 7. VALIDATE — mandatory; not done until data lands

Ship the bundled self-verifying trace test into the target (TS: `validate-trace.test.ts`, a
`TestWorkflowEnvironment` in-memory-exporter test asserting the full parent span chain) and run
it — it re-proves the wiring against **this project's actual installed deps and its real trigger
path** (so a broken SDK subpath / changed OTLP path fails **here**, not silently in prod). Then
do an opt-in live check (`OTEL_LIVE_VERIFY=1`) that exports to real PostHog and reads the trace
back. **Not done until both logs and a trace land in PostHog.**

## Configuration reference

| Env var | Status | Purpose / default |
|---|---|---|
| `POSTHOG_PROJECT_API_KEY` | **REQUIRED** | `phc_` — master switch + OTLP `Bearer` auth. No export without it. |
| `POSTHOG_HOST` | optional (region) | PostHog **ingestion** host; defaults to `https://eu.i.posthog.com`. Set only for non-EU (US: `https://us.i.posthog.com`). **Not** the app host. |
| `OTEL_TRACES_SAMPLER_RATIO` | recommended | `ParentBased(TraceIdRatioBased)` head sampler; default `1.0`; **lower in PRD** (e.g. `0.1`) for cardinality/cost. |
| `OTEL_SERVICE_NAME` | recommended | `service.name` resource attr (the routing/filter dimension in PostHog). |
| `OTEL_ENABLED` | optional | Explicit on/off override; unset → follows the token. `false` force-disables even with a token. |
| `OTEL_LOG_LEVEL` | optional | Min log level for the OTEL log pipeline; default `info`. |

**PostHog OTLP specifics:** export to `<POSTHOG_HOST>/i/v1/traces` and `<POSTHOG_HOST>/i/v1/logs`
with header `Authorization: Bearer <phc_…>`. ⚠️ The generic `OTEL_EXPORTER_OTLP_ENDPOINT`
convention **404s** against PostHog — you must hit the `/i/v1/...` ingestion paths on the `i.`
host. One `phc_` key does three jobs (traces auth, logs auth, and any flag reads) — don't
provision separate keys.

## Per-language lookup (the only thing that differs)

OTEL SDKs + the same general logic, per language. Always look up current APIs via `context7` /
official docs:

- **TypeScript/Node** — bundled reference; `@opentelemetry/sdk-node`, `sdk-logs`, `api-logs`, OTLP exporters; Temporal: `@temporalio/interceptors-opentelemetry`.
- **Go** — `go.opentelemetry.io/otel`, `otel/sdk`, OTLP/HTTP exporters, `otel/log`; Temporal Go SDK interceptors.
- **Python** — `opentelemetry-sdk`, `opentelemetry-exporter-otlp`, the logs SDK; Temporal Python interceptors.
- **Java/.NET/Ruby/…** — analogous SDKs.

PostHog OTLP target + the env-var contract above are **identical** in all of them.

## Lessons learned (read this — production-proven)

- **Pino/bridge logs vanish under pure ESM.** A logging-lib→OTEL bridge silently dropped every record. **Emit natively** via the OTEL Logs API instead — deterministic, and auto trace-correlated.
- **Logs landed but no trace.** A long-running cron-loop workflow + a trigger client with no OTEL interceptor meant **no root span was ever opened**, so PostHog had logs but zero traces. Always open the trace **at the real trigger** (Step 3) — and a green CI test that uses `client.start` can hide this, because production is triggered differently.
- **The generic OTLP endpoint 404s.** PostHog needs `/i/v1/traces` + `/i/v1/logs` on the `i.` ingestion host, not the app host, not `/v1/...`.
- **Register the tracer provider LAST.** If you register first and a later step throws, you leak a registered-but-abandoned provider that keeps exporting while your handle says "degraded."
- **`Resource.empty()` on fallback** — don't re-run a `buildResource()` that just threw.
- **`phc_` is publishable**, `phx_` (personal/dataset) is sensitive — `oteltrace` only needs `phc_`.

## Forbidden / guardrails

- Never call an exporter (or any IO/clock/random) inside a sandboxed execution context (e.g. a Temporal workflow) — export from the host process via the sanctioned Sink.
- Never echo, commit, or log the API key; only write it to a gitignored `.env` / existing env var.
- Never silently rewrite logging — always emit the change report + flag ambiguous sites + verify no residual + build green.
- Never let telemetry throw out of bootstrap — fail soft to console-only.
- Don't touch AI/LLM tracing or its env vars — that's `aitrace`.

## The mastrahog ecosystem (so you know the boundaries)

- **`mastrahog:aitrace`** — native PostHog **AI** tracing (`$ai_*`) for Mastra/LLM apps.
- **`mastrahog:oteltrace`** *(this skill)* — native PostHog **logs + distributed traces** for any app, any language. Same PostHog project, different signal.

## When you're done

The project emits native OTEL **logs and a trace** to PostHog; existing logging is migrated
(with a change report); the trace opens at the real trigger; redaction is in place; the env
vars are documented and the `phc_` key is set safely; and the bundled self-verifying test
passes against the project's real deps. Tell the human exactly what landed in PostHog and how
to lower the sampler ratio in PRD.

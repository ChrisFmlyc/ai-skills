# tracing — observability, wired and validated

Call a skill, get correct instrumentation wired in, and have it **proven end-to-end**
against real data — no need to learn the SDK internals yourself.

`oteltrace` is the general one: **any app, any language** — OpenTelemetry logs,
distributed traces and liveness metrics, governed by a bundled OpenTelemetry standard.
`aitrace` is the LLM-specific one: native PostHog `$ai_*` tracing for Mastra. Both
export to the same PostHog project; they cover different signals.

## Skills

- `/tracing:aitrace` — wire native PostHog AI tracing into a Mastra TypeScript
  project and validate it. Installs `@mastra/observability` + `@mastra/posthog`,
  drops in the master code (`buildPostHogObservability()` + `withUser()` helpers),
  wires it into your `Mastra` instance, sets env, then runs the agent and reads
  the traces back from PostHog to confirm they're landing.

  Covers: native tracing, generations, users, sessions, errors, and live
  evaluations. **Tool calling is a known upstream gap** (`@mastra/posthog` exports
  trace metadata only, not tool-call payloads) — the skill says so plainly rather
  than faking a populated Tools tab.

`/tracing:aitrace` is **slash-only** (`disable-model-invocation: true`) — type
`/tracing:aitrace` to run it. It installs dependencies and edits your Mastra
instance, so it never starts on its own.

- `/tracing:oteltrace` — the **non-AI counterpart**. Wires native **OpenTelemetry
  logs + distributed traces** into a project and exports them to PostHog, validated
  end-to-end. Where `aitrace` handles LLM `$ai_*` observability, `oteltrace` handles
  application **logs + request/workflow traces**.

  **Language-agnostic:** it encodes the general logic and looks up the target
  language's OTEL SDK per run (TypeScript is the bundled, production-proven reference
  example; Go/Python/etc. supported by design — PostHog's OTLP ingestion is identical).

  It is governed by a bundled **OpenTelemetry standard** (`resources/oteltrace/OTEL-STANDARD.md`)
  — one telemetry API, spans only for things that actually happened, no orphan spans,
  allow-lists over deny-lists, suppression at the call site, credentials never on a span
  or a log line, and a test per gate that's verified by reverting it.

  Covers: fail-soft telemetry bootstrap, console-as-an-exporter, **migrating any existing
  logging** (console/pino/winston/bunyan/…) into the OTel SDK, **opening the trace at the
  real trigger** (the "logs-but-no-trace" trap), span-noise cleanup, the mandatory
  liveness counter behind any conditional span, **error handling** (exception event +
  ERROR span status + correlated log + failure counter, and a flush on crash/SIGTERM so
  the last records survive), redaction on **both** the log and trace pipelines, the
  env-var contract, and a bundled **self-verifying trace test**. Lives at
  `skills/oteltrace/` with bundled TS reference under `resources/oteltrace/`.

  Note: PostHog **Error Tracking** issues come from the PostHog SDK's `captureException`,
  not from OTLP — the skill offers to wire that too, but asks first.

`/tracing:oteltrace` is **slash-only** (`disable-model-invocation: true`) — type
`/tracing:oteltrace` to run it. It rewrites every logging call in the project, so
it never starts on its own.

### Which one?

| You want… | Skill |
|---|---|
| LLM traces, generations, token/cost, `$ai_*` | `aitrace` |
| App logs, request/workflow distributed traces, liveness metrics, error handling | `oteltrace` |
| Span-noise cleanup — orphans, plumbing spans, traced health probes | `oteltrace` |
| Any of the above in Go / Python / Java / …, not just TypeScript | `oteltrace` |

## Install

From the `ai-skills` marketplace:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install tracing@ai-skills
```

Restart Claude Code so the new slash command registers.

## Update

```
/plugin marketplace update ai-skills
/plugin update tracing@ai-skills
```

## Uninstall

```
/plugin uninstall tracing@ai-skills
```

## What it needs

Both skills:

- A PostHog **project** token (`phc_…`) and your region host
  (`https://eu.i.posthog.com` / `https://us.i.posthog.com` / self-host).

`/tracing:oteltrace` additionally:

- Any project in any language with an OpenTelemetry SDK. TypeScript ships as the
  bundled, production-proven reference; other languages are translated per run from
  the current official docs.

`/tracing:aitrace` additionally:

- A Mastra (TypeScript) project (`@mastra/core`).
- For the validation read-back: a personal API key (`phx_…`) + project id
  (optional — without it the skill tells you to verify in the PostHog UI).

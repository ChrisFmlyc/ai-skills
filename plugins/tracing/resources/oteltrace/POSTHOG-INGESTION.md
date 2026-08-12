# PostHog ingestion reference

Where each signal goes, what makes it clickable once it arrives, the env-var
contract, and the per-language SDK lookup. PostHog's own docs, not inference.

`tracing:oteltrace` links here from Steps 11 and 12; read it when wiring the
exporter or documenting config.

## Contents

- Where each signal lands
- What makes a record clickable
- Getting identity from the browser to the backend
- Configuration reference
- Per-language lookup

---

## Where each signal lands

| Signal | Route into PostHog | Notes |
|---|---|---|
| **Traces** | OTLP → `<POSTHOG_HOST>/i/v1/traces` | Generic OTLP receiver, no PostHog SDK. Distributed tracing is **beta**. |
| **Logs** | OTLP → `<POSTHOG_HOST>/i/v1/logs` | OTel-native: "point any OTLP client at PostHog". |
| **Metrics** | OTLP → `<POSTHOG_HOST>/i/v1/metrics` | **Alpha** — verify before an alert depends on it. |
| **Error Tracking** | **NOT OTLP** — `$exception` events from a PostHog SDK (`captureException`) | See Step 9. No OTLP path exists on any platform. |

All three OTLP endpoints take `Authorization: Bearer <phc_…>` (the same project
key; PostHog also accepts `?token=`). ⚠️ Pass the **full `/i/v1/…` path** —
PostHog's docs say explicitly not to use the bare `OTEL_EXPORTER_OTLP_ENDPOINT`
variable, and the generic convention **404s**.

## What makes a record clickable

These names are PostHog's, not yours to choose.

| Want | Put this on the record |
|---|---|
| Log ↔ trace (both directions) | Nothing — OTLP log records carry `trace_id` / `span_id` natively, and PostHog exposes both as top-level filters (hex or base64). This is why §5's "pass the context" rule is the whole game. |
| Log/trace → **person** | log attribute **`posthogDistinctId`** — matched against *every* `distinct_id` PostHog knows for that person, so any one identifier links it (identified-after-anonymous still resolves). Key is configurable in project settings. |
| Log/trace → **session replay** | attribute **`sessionId`** |
| Service / environment facets | resource attrs `service.name` and **`deployment.environment.name`** (the *current* semconv name — the legacy `deployment.environment` doesn't drive the facet). `host.name` and the `k8s.*` attrs light up their own facets when present. |
| Severity filter | standard OTel severity → `severity_level` (`trace`/`debug`/`info`/`warn`/`error`/`fatal`) |

## Getting identity from the browser to the backend

`posthog-js` will inject it for you:

```js
posthog.init(key, { tracing_headers: ['api.your-app.com'] })
```

That adds `X-POSTHOG-SESSION-ID` and `X-POSTHOG-DISTINCT-ID` to `fetch`/XHR
calls to those hosts. Read them at your edge, put them in the request context,
and stamp them onto every log and span from there inward (TS:
`posthog-context.ts` does this, and `logger.ts` merges them onto every record
automatically).

This is **in addition to** W3C `traceparent`, not instead of it: `traceparent`
decides the trace, these decide the person and the replay. If the frontend is
PostHog-instrumented the ids arrive on their own; if not, don't fabricate them.

## Configuration reference

| Env var | Status | Purpose / default |
|---|---|---|
| `POSTHOG_PROJECT_API_KEY` | **REQUIRED** | `phc_` — master switch + OTLP `Bearer` auth. No export without it. |
| `POSTHOG_HOST` | optional (region) | PostHog **ingestion** host; defaults to `https://eu.i.posthog.com`. Set only for non-EU (US: `https://us.i.posthog.com`). **Not** the app host. |
| `OTEL_TRACES_SAMPLER_RATIO` | recommended | `ParentBased(TraceIdRatioBased)` head sampler; default `1.0`; **lower in PRD** (e.g. `0.1`) for cardinality/cost. |
| `OTEL_SERVICE_NAME` | recommended | `service.name` resource attr (the routing/filter dimension in PostHog). |
| `OTEL_ENABLED` | optional | Explicit on/off override; unset → follows the token. `false` force-disables even with a token. |
| `OTEL_LOG_LEVEL` | optional | Min log level for the OTel log pipeline; default `info`. |

One `phc_` key does every job (traces, logs, metrics, error tracking, and any
flag reads) — don't provision separate keys. The host is the **ingestion** host
(`i.`), not the app host.

**Sampling is a cost control, not a noise control.** Do not reach for it to hide
orphan or plumbing spans — those get fixed at the call site (§2, §3), or they
come back at ratio `1.0`.

## Per-language lookup

The same general logic, per language. Always look up current APIs via `context7`
or the official docs — SDK APIs drift.

- **TypeScript/Node** — bundled reference in this directory; `@opentelemetry/sdk-node`, `sdk-logs`, `api-logs`, OTLP exporters; Temporal: `@temporalio/interceptors-opentelemetry`.
- **Go** — `go.opentelemetry.io/otel`, `otel/sdk`, OTLP/HTTP exporters, `otel/log` + `otelslog`; Temporal Go SDK interceptors.
- **Python** — `opentelemetry-sdk`, `opentelemetry-exporter-otlp`, the logs SDK + `LoggingHandler`; Temporal Python interceptors.
- **Java / .NET / Ruby / …** — analogous SDKs (Logback/Log4j appenders on the JVM).

The PostHog OTLP target and the env-var contract above are **identical** in all
of them. The per-language work is idiom translation, not a different design.

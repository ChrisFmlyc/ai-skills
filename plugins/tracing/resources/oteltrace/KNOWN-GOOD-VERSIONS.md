# oteltrace — known-good versions (TypeScript reference)

These are the package versions the bundled TypeScript reference was authored and
proven against. The bundle is a **point-in-time snapshot**, not a linked library —
pin these (or newer, verified) versions in the target project. The fragile one is
`@temporalio/interceptors-opentelemetry`: it ships **no `exports` map**, so the
sandbox-safe `/lib/workflow/index.js` subpath used by `otel-workflow-interceptors.ts`
is an internal path that a **major** upgrade can move. If a Temporal upgrade breaks
that import, the bundled self-verifying test (`validate-trace.test.ts`) fails at
instrument time — fix the subpath then, not in production.

## OpenTelemetry (JS)

| Package | Known-good |
|---|---|
| `@opentelemetry/api` | `^1.9` |
| `@opentelemetry/api-logs` | `^0.57` |
| `@opentelemetry/sdk-trace-base` | `^1.30` |
| `@opentelemetry/sdk-trace-node` | `^1.30` |
| `@opentelemetry/sdk-logs` | `^0.57` |
| `@opentelemetry/sdk-metrics` | `^1.30` |
| `@opentelemetry/exporter-trace-otlp-proto` | `^0.57` |
| `@opentelemetry/exporter-logs-otlp-http` | `^0.57` |
| `@opentelemetry/exporter-metrics-otlp-http` | `^0.57` |
| `@opentelemetry/resources` | `^1.30` |
| `@opentelemetry/semantic-conventions` | `^1.30` |

## Temporal (only for Temporal-worker targets)

| Package | Known-good | Note |
|---|---|---|
| `@temporalio/interceptors-opentelemetry` | pin exactly | no `exports` map — the `/lib/workflow` subpath is internal |
| `@temporalio/worker` / `client` / `workflow` | match your Temporal SDK | — |
| `@temporalio/testing` | dev — for `validate-trace.test.ts` | — |

## OTel JS 1.x vs 2.x

This reference targets **1.x**: it builds resources with `new Resource({...})`. In OTel JS
**2.x** that constructor was removed — use `resourceFromAttributes({...})` from
`@opentelemetry/resources`, which is what PostHog's own installation docs show. If you pin
2.x in the target project, that is the one call to translate.

## PostHog OTLP (version-independent — but easy to get wrong)

- Traces: `<POSTHOG_HOST>/i/v1/traces`
- Logs: `<POSTHOG_HOST>/i/v1/logs`
- Metrics: `<POSTHOG_HOST>/i/v1/metrics` — PostHog Metrics is **alpha**; the endpoint may move. Verify it before relying on a liveness alert, and route the counter elsewhere if it has.
- Auth: `Authorization: Bearer <phc_…>` (a `?token=<phc_…>` query param also works)
- Host: ingestion host `https://eu.i.posthog.com` (EU) / `https://us.i.posthog.com` (US) — **not** the app host, **not** `/v1/...`.
- Error Tracking is **not** on this list: it ingests `$exception` events from a PostHog SDK (`captureException`), never OTLP.

## PostHog linking attributes (their names, not yours)

| Attribute | Effect |
|---|---|
| `posthogDistinctId` (log attribute) | Links the record to a person — matched against every `distinct_id` PostHog knows for them. Key is configurable in project settings. |
| `sessionId` (log attribute) | Links the record to the session replay. |
| `service.name` (resource) | Service facet + filter. |
| `deployment.environment.name` (resource) | Environment facet. The legacy `deployment.environment` does **not** drive it — the reference emits both. |
| `trace_id` / `span_id` | Native OTLP log-record fields, exposed as top-level PostHog filters (hex or base64). Nothing to set — just don't drop the context. |

`posthog-js` with `tracing_headers: ['api.your-app.com']` injects `X-POSTHOG-SESSION-ID`
and `X-POSTHOG-DISTINCT-ID` into fetch/XHR calls, which is where a backend gets those two
values (see `posthog-context.ts`).

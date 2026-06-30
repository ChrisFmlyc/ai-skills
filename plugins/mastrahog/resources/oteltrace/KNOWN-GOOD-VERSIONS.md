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
| `@opentelemetry/exporter-trace-otlp-proto` | `^0.57` |
| `@opentelemetry/exporter-logs-otlp-http` | `^0.57` |
| `@opentelemetry/resources` | `^1.30` |
| `@opentelemetry/semantic-conventions` | `^1.30` |

## Temporal (only for Temporal-worker targets)

| Package | Known-good | Note |
|---|---|---|
| `@temporalio/interceptors-opentelemetry` | pin exactly | no `exports` map — the `/lib/workflow` subpath is internal |
| `@temporalio/worker` / `client` / `workflow` | match your Temporal SDK | — |
| `@temporalio/testing` | dev — for `validate-trace.test.ts` | — |

## PostHog OTLP (version-independent — but easy to get wrong)

- Traces: `<POSTHOG_HOST>/i/v1/traces`
- Logs: `<POSTHOG_HOST>/i/v1/logs`
- Auth: `Authorization: Bearer <phc_…>`
- Host: ingestion host `https://eu.i.posthog.com` (EU) / `https://us.i.posthog.com` (US) — **not** the app host, **not** `/v1/...`.

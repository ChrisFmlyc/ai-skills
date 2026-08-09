# oteltrace — bundled reference (TypeScript)

These files are the **worked reference example** the `oteltrace` skill copies +
adapts into a TypeScript/Node target. They are a self-contained, point-in-time
snapshot (no dependency back on any other repo). For non-TS targets, the skill
translates the same general logic into that language's OTEL SDK — these are the
canonical demonstration of *what* to build.

| File | What it is |
|---|---|
| `OTEL-STANDARD.md` | **The governing document.** Backend-agnostic rules for spans, logs, metrics, correlation, links, redaction and testing. Read it first; on any conflict it wins over the code below. |
| `telemetry.ts` | Fail-soft `createTelemetry()` bootstrap: console-as-an-exporter, OTel Logs API, register-tracer-last, redaction ahead of every exporter on both pipelines, empty-resource fallback. The showpiece. |
| `logger.ts` | OTel Logs API logger (emits natively rather than via a bridge — see §0); auto trace-correlated; lifts Error fields. |
| `posthog-context.ts` | Cross-service context (§6): `traceparent` inject / detached extract / graft-onto-live, plus PostHog's `posthogDistinctId` + `sessionId` identity headers so logs and spans link to the person and the session replay. `logger.ts` merges these onto every record. |
| `errors.ts` | Error recording where the standard puts it — span event + ERROR status (§4, §7), correlated log, counter (§8) — plus the `uncaughtException` / `unhandledRejection` / `SIGTERM` / `SIGINT` handlers that flush with a timeout so a crash doesn't take its own telemetry with it. Notes where PostHog Error Tracking (`$exception`) differs. |
| `gating.ts` | §1–§3 made concrete: the per-cycle liveness counter (built **first**), private-context-key suppression, and `runGated()` — check outside the span, open it only when there is work. |
| `redaction.ts` | Both halves of §9: `RedactionLogRecordProcessor` for the log pipeline, `RedactingSpanExporter` + `sanitizeUrl` for the trace pipeline (capability URLs, `url.*` / `http.*` variants). |
| `temporal-otel.ts` | Temporal client/worker OTel wiring incl. `buildClientWorkflowInterceptors` — **open the trace at the trigger**. |
| `otel-workflow-interceptors.ts` | Sandbox-safe workflow interceptor module (composes SDK classes only; the `/lib/workflow` subpath note). |
| `validate-trace.test.ts` | Self-verifying trace-chain test (in-memory exporter), the redaction+correlation test, and the opt-in live-PostHog check. |
| `KNOWN-GOOD-VERSIONS.md` | Pinned package versions + the PostHog OTLP path/auth facts. |

Adapt module paths, config wiring, and probe names to the target project. Honour the
load-bearing rules called out in each file's header (fail-soft; console-is-an-exporter;
export-from-the-host-process-never-the-sandbox; open-the-trace-at-the-trigger; redact
both pipelines) — and, above all, `OTEL-STANDARD.md`.

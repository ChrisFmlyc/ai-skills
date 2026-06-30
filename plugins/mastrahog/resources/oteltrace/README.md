# oteltrace — bundled reference (TypeScript)

These files are the **worked reference example** the `oteltrace` skill copies +
adapts into a TypeScript/Node target. They are a self-contained, point-in-time
snapshot (no dependency back on any other repo). For non-TS targets, the skill
translates the same general logic into that language's OTEL SDK — these are the
canonical demonstration of *what* to build.

| File | What it is |
|---|---|
| `telemetry.ts` | Fail-soft `createTelemetry()` bootstrap: always-on console exporter, native Logs API, register-tracer-last, redaction-before-export, empty-resource fallback. The showpiece. |
| `logger.ts` | Native OTEL Logs API logger (no logging-lib bridge); auto trace-correlated; lifts Error fields. |
| `redaction.ts` | Redaction `LogRecordProcessor` (denylist scrubber) — runs **before** the OTLP exporter. |
| `temporal-otel.ts` | Temporal client/worker OTEL wiring incl. `buildClientWorkflowInterceptors` — **open the trace at the trigger**. |
| `otel-workflow-interceptors.ts` | Sandbox-safe workflow interceptor module (composes SDK classes only; the `/lib/workflow` subpath note). |
| `validate-trace.test.ts` | Self-verifying trace-chain test (in-memory exporter) + opt-in live-PostHog check. |
| `KNOWN-GOOD-VERSIONS.md` | Pinned package versions + the PostHog OTLP path/auth facts. |

Adapt module paths, config wiring, and probe names to the target project. Honour the
load-bearing rules called out in each file's header (fail-soft; console-always-on;
export-from-the-host-process-never-the-sandbox; open-the-trace-at-the-trigger).

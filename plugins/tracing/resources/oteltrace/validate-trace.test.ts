// ── Self-verifying trace test — oteltrace reference, TypeScript ──
//
// Ships INTO the target project. It re-proves the OTEL client → workflow → activity
// trace chain against the project's ACTUAL installed deps and its real wiring, using
// an in-memory exporter (no network) — so a broken SDK subpath / changed OTLP path
// fails HERE, at instrument time, not silently in production.
//
// The `OTEL_LIVE_VERIFY` block (skipped by default) exports to real PostHog so a
// human can read the trace back once — gate live egress behind the env flag.
//
// Adapt the workflow/activity names + interceptor wiring to the target project.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  ParentBasedSampler,
  AlwaysOnSampler,
} from '@opentelemetry/sdk-trace-base';
import { OpenTelemetryWorkflowClientInterceptor } from '@temporalio/interceptors-opentelemetry';
// The PRODUCTION wrapper, not a test copy — deleting it from telemetry.ts must fail here.
import { makeRedactingSpanExporter } from './redaction.js';
// import the project's worker OTEL wiring (buildWorkerOtelConfig) + a probe workflow/activity.

describe('oteltrace: client → workflow → activity trace chain', () => {
  let env: TestWorkflowEnvironment;
  const exporter = new InMemorySpanExporter();

  beforeAll(async () => {
    const provider = new BasicTracerProvider({
      sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    env = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  it('produces one trace with the full parent chain (root → StartWorkflow → RunWorkflow → StartActivity → RunActivity)', async () => {
    // Wire the worker with the project's buildWorkerOtelConfig(...) (sinks + interceptors),
    // run a trivial probe workflow that calls one activity, started by a Client carrying
    // the OpenTelemetryWorkflowClientInterceptor inside a manual `root` span.
    //
    //   const otel = buildWorkerOtelConfig(testTelemetryHandle);
    //   const worker = await Worker.create({ connection, taskQueue, workflowsPath, activities,
    //       sinks: otel?.sinks, interceptors: { workflowModules: otel?.interceptors.workflowModules } });
    //   const client = new Client({ connection, interceptors: { workflow: [new OpenTelemetryWorkflowClientInterceptor()] } });
    //   await tracer.startActiveSpan('root', async (root) => { await client.workflow.execute('probe', {...}); root.end(); });

    const spans = exporter.getFinishedSpans();
    const names = spans.map((s) => s.name);

    // The chain — adapt the names to your probe workflow/activity.
    expect(names.some((n) => n === 'root' || n.includes('test-root'))).toBe(true);
    expect(names.some((n) => n.startsWith('StartWorkflow'))).toBe(true);
    expect(names.some((n) => n.startsWith('RunWorkflow'))).toBe(true);
    expect(names.some((n) => n.startsWith('StartActivity'))).toBe(true);
    expect(names.some((n) => n.startsWith('RunActivity'))).toBe(true);

    // Premise first — an "all spans are fine" assertion is vacuous over zero spans
    // (OTEL-STANDARD.md §10, "vacuous by absence").
    expect(spans.length).toBeGreaterThan(0);

    // All spans share ONE trace_id, and exactly one root — no orphans (§2).
    const traceIds = new Set(spans.map((s) => s.spanContext().traceId));
    expect(traceIds.size).toBe(1);
    expect(spans.filter((s) => !s.parentSpanId)).toHaveLength(1);
  });
});

// ── §9 + §5: redaction and correlation, asserted TOGETHER ──────────────────
//
// Two traps this block exists to avoid: asserting the property without the
// premise ("the trace id survived redaction" proves nothing if nothing was
// redacted), and testing a copy of the config (this imports the PRODUCTION
// exporter wrapper, so deleting it from telemetry.ts must fail a test).
describe('oteltrace: credentials never leave, correlation always does', () => {
  it('redacts a capability URL on the exported span while keeping trace_id + span_id', async () => {
    const inner = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(makeRedactingSpanExporter(inner))],
    });
    const tracer = provider.getTracer('oteltrace-test');

    const secret = 'a'.repeat(40);
    const span = tracer.startSpan('outbound');
    span.setAttribute('url.full', `https://api.example.com/callback/${secret}?token=${secret}`);
    span.setAttribute('http.route', '/callback/:id'); // route templates must survive intact
    const { traceId, spanId } = span.spanContext();
    span.end();
    await provider.forceFlush();

    const [exported] = inner.getFinishedSpans();
    expect(exported).toBeDefined();

    // Premise: the scrub actually happened.
    expect(JSON.stringify(exported.attributes)).not.toContain(secret);
    expect(String(exported.attributes['url.full'])).toContain('api.example.com'); // non-secret parts preserved
    expect(exported.attributes['http.route']).toBe('/callback/:id');

    // Property: correlation survives the stage that rewrites records in flight.
    expect(exported.spanContext().traceId).toBe(traceId);
    expect(exported.spanContext().spanId).toBe(spanId);
  });

  // Do the same for the LOG pipeline — §9: different code path, audited separately.
  // Emit through the production logger, assert on what the EXPORTER received (not a
  // hand-made record passed to the processor hook), and assert BOTH ids are present.
  it.todo('redacts a denylisted log attribute and keeps trace_id + span_id on the record');

  // §10: the repeat path is what every restart after the first takes.
  it.todo('createTelemetry is idempotent and degrades to console-only on a bad token');
});

describe.skipIf(!process.env.OTEL_LIVE_VERIFY)('oteltrace: live PostHog egress (opt-in)', () => {
  it('exports a trace to real PostHog and prints the trace_id', async () => {
    // Stand up the REAL project telemetry (createTelemetry with the live phc_ key),
    // run the probe, flush, and print the trace_id so a human can open it in PostHog.
    // Gate ALL network egress behind OTEL_LIVE_VERIFY so CI never hits PostHog.
    expect(process.env.POSTHOG_PROJECT_API_KEY).toBeTruthy();
  });
});

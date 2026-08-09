// ── Temporal ↔ OpenTelemetry wiring — oteltrace reference, TypeScript ──
//
// Makes ONE trace span client → workflow → activity. All wiring reuses the SAME
// OTLP span processor + resource from telemetry.ts, so workflow, activity, and
// process spans export through one exporter.
//
// SANDBOX SAFETY (load-bearing): workflow spans are NOT exported by calling an
// exporter inside workflow code. They ride Temporal's sanctioned path — in-sandbox
// workflow interceptors emit serialisable spans across the isolate boundary to the
// `exporter` Sink built by makeWorkflowExporter, which runs the real OTLP export in
// the host process. No clock/random/IO is added to the sandbox.
//
// TRACE AT THE TRIGGER (the bug this skill exists to prevent): a workflow only gets
// a trace if a ROOT span is opened where it is STARTED. Whatever starts the workflow
// (a trigger CLI, a gateway, a Schedule handler) MUST carry the client interceptor
// below — otherwise PostHog sees logs but no trace. See buildClientWorkflowInterceptors.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  OpenTelemetryActivityInboundInterceptor,
  OpenTelemetryActivityOutboundInterceptor,
  OpenTelemetryWorkflowClientInterceptor,
  makeWorkflowExporter,
  type OpenTelemetrySinks,
} from '@temporalio/interceptors-opentelemetry';
import type { InjectedSinks, WorkerInterceptors } from '@temporalio/worker';
import type { WorkflowClientInterceptor } from '@temporalio/client';
import type { TelemetryHandle } from './telemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the PROJECT-OWNED workflow interceptor module Temporal bundles into the sandbox. */
function resolveWorkflowInterceptorsModule(): string {
  const js = path.resolve(__dirname, '..', 'workflows', 'otel-workflow-interceptors.js');
  if (existsSync(js)) return js;
  const ts = path.resolve(__dirname, '..', 'workflows', 'otel-workflow-interceptors.ts');
  if (existsSync(ts)) return ts;
  throw new Error(`OTEL workflow interceptors module not found at ${js} or ${ts}`);
}

export interface WorkerOtelConfig {
  sinks: InjectedSinks<OpenTelemetrySinks>;
  interceptors: WorkerInterceptors;
}

/** Worker-side OTEL config (workflow span Sink + interceptors). undefined when disabled (fail-soft). */
export function buildWorkerOtelConfig(telemetry: TelemetryHandle | undefined): WorkerOtelConfig | undefined {
  if (!telemetry?.enabled || !telemetry.workflowSpanProcessor) return undefined;
  try {
    const workflowInterceptorsModule = resolveWorkflowInterceptorsModule();
    return {
      sinks: { exporter: makeWorkflowExporter(telemetry.workflowSpanProcessor, telemetry.resource) },
      interceptors: {
        workflowModules: [workflowInterceptorsModule],
        activity: [
          (ctx) => ({
            inbound: new OpenTelemetryActivityInboundInterceptor(ctx),
            outbound: new OpenTelemetryActivityOutboundInterceptor(ctx),
          }),
        ],
      },
    };
  } catch (err) {
    process.stderr.write(
      `[telemetry] worker OTEL wiring failed; continuing without workflow/activity tracing: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return undefined;
  }
}

/**
 * Client-side interceptors so the code that STARTS a workflow opens the ROOT span
 * of the trace and propagates context into the workflow headers. THIS is what makes
 * a trace exist — attach it to every Client that starts (or signals/queries)
 * workflows, including trigger CLIs and Schedule handlers. undefined when disabled.
 */
export function buildClientWorkflowInterceptors(
  telemetry: TelemetryHandle | undefined,
): WorkflowClientInterceptor[] | undefined {
  if (!telemetry?.enabled) return undefined;
  return [new OpenTelemetryWorkflowClientInterceptor()];
}

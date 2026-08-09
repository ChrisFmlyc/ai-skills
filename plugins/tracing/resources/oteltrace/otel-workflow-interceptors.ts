// ── Project-owned workflow-sandbox OTEL interceptor module — oteltrace reference ──
//
// Temporal resolves this via `interceptors.workflowModules` (see temporal-otel.ts)
// and BUNDLES it into the workflow sandbox, so it must obey the sandbox determinism
// contract: no clock/random/IO, no exporter calls. It only composes the SDK's OTEL
// workflow interceptor classes; the actual span export happens out-of-sandbox via
// the `exporter` Sink.
//
// Import the `./workflow` SUBPATH, not the package root: the root pulls in
// worker/client/plugin code that is forbidden (and non-bundleable) inside the
// sandbox. `@temporalio/interceptors-opentelemetry` ships no `exports` map, so this
// internal subpath is the shallowest sandbox-safe entry — pin the package version
// (see KNOWN-GOOD-VERSIONS.md); a major upgrade can move it.
import {
  OpenTelemetryInboundInterceptor,
  OpenTelemetryOutboundInterceptor,
  OpenTelemetryInternalsInterceptor,
} from '@temporalio/interceptors-opentelemetry/lib/workflow/index.js';
import type { WorkflowInterceptors } from '@temporalio/workflow';

export const interceptors = (): WorkflowInterceptors => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()],
  internals: [new OpenTelemetryInternalsInterceptor()],
});

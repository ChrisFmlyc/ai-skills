# OpenTelemetry Standard

The authoritative rules for observability on a distributed system instrumented
with OpenTelemetry. **Where this document and anything else disagree, this
document wins.** The rules are ordered so that later ones depend on earlier ones.

This standard is **backend-agnostic**. The PostHog-specific parts (OTLP paths,
auth header, env contract) live in the `oteltrace` skill, not here.

---

## 0. OTel is the only telemetry API

**All three signals — traces, metrics and logs — go through the OpenTelemetry
SDK.** There is no second telemetry system running alongside it.

### Logging in particular

Do NOT `print()` / `console.log()` / write to stdout and then have something
downstream scrape and re-parse it. That path throws away structure you already
had and then pays to guess it back. It also loses trace correlation entirely,
because a text line has nowhere to put a span id.

Instead, get the language's normal logging API into the OTel logs SDK:

| Language | Bridge |
|---|---|
| Go | `log/slog` → `otelslog` handler |
| Python | stdlib `logging` → OTel `LoggingHandler` |
| Node/TS | pino/winston → OTel appender, **or the logs API directly** |
| Java | Logback/Log4j → OTel appender |

Application code keeps calling the logger it already uses. The OTel SDK becomes
the backend. Emitting through the OTel logs API directly is equally compliant —
what the rule forbids is a *second* pipeline, not a particular entry point.

**Console output is an exporter, not a separate code path.** If you want stdout
in development, attach a `ConsoleExporter` to the *same* LoggerProvider that has
the OTLP exporter. One pipeline, two exporters. Never two log systems that can
disagree.

Consequences that follow automatically once this is true:

- Every log record carries `trace_id` and `span_id` when one is active.
- Redaction, sampling and enrichment are configured once and apply to console
  and remote output alike.
- Resource attributes (`service.name`, `deployment.environment`, version) are set
  once on the provider and attached to every signal — stop repeating them in
  every log call.

### Attributes, not string interpolation

`logger.info("processed order", order.id=id, outcome="ok")` — not
`logger.info(f"processed order {id} ok")`. Structured fields are queryable;
interpolated strings are not, and a regex over them is the parsing you removed.

### Export

Send everything over **OTLP** to your collector or backend. Do not invent a
custom shipping format. If the backend needs a different shape, that is a
collector/exporter concern, not an application concern.

---

## 1. Spans are for actions

> **Only emit a span for something that HAPPENED. Looking is not happening.**

| Situation | Span? |
|---|---|
| Request arrives / message consumed | **Yes** |
| Scheduled job runs and does work | **Yes** |
| Scheduled job runs and finds nothing to do | **No** — status check |
| Retry that reprocesses a message | **Yes** |
| Poll that finds nothing stalled | **No** |
| Queue/DB plumbing (read, ack, pending, length, ping, group-create) | **No** |
| Health/readiness probe | **Never** |
| CORS preflight, static asset, 404 | **Never** |
| Framework middleware layers, SDK internal handler pipelines | **Never** |

### Check first, then open the span

Do the lookup **outside** any span; open it only once you know there is work.
Deliberately this way round rather than opening a span and dropping it later:
nothing is allocated for a no-op, and there is no filter config that can drift
out of agreement with the code.

The lookup's duration falls outside the span. That is correct — the lookup is a
check, not the work.

### "Nothing to do" is NOT "no records"

Gate on whether this run will **act**, not on whether there is anything to look
at. A long-lived pending record makes "are there any records?" permanently true,
so a job gated that way traces every run forever while doing nothing.

Because deciding is itself a check, the decision must run **before** tracing and
with spans suppressed — including any network call the decision makes.

```
run starts
  → read candidates          (suppressed)
  → decide per candidate     (suppressed, incl. status lookups)
  → nothing actionable? → increment counter, log, RETURN — no span
  → otherwise            → open span, act
```

### Liveness moves to metrics — build the counter FIRST

Once the empty case emits no span, "no span" and "the process is dead" are
identical. Anything you make conditional needs a counter incremented **every
cycle regardless of outcome**, alerted on its **absence**.

Make the counter before you make the span conditional, not after.

---

## 2. No orphan spans

A **root span is fine** — an entry point should be a root.

An **orphan** is a root with no children describing a single round-trip: no
caller, no request, no outcome. Technically a valid one-span trace; practically
useless. It answers no question anyone opens a trace view to ask, and it buries
the ones that do.

### Why they appear

Auto-instrumented calls that run outside any active span have no parent to attach
to. In a consumer loop the queue read happens before the handling span opens and
the ack after it closes — so both become standalone roots. Not a bug in the call;
a consequence of where it sits.

### The only two valid fixes

1. **Suppress it** — nothing worth recording happened.
2. **Give it a parent that states the outcome** — something did happen; the calls
   are the mechanism, the parent is the result.

Example of (2): N separate HTTP roots at startup loading configuration → one
`config.load` span carrying `outcome` and a count. Trace it rather than suppress
it when failure is silent and consequential.

Never leave a bare round-trip.

### Prefer structural prevention over filtering

Options that make orphans impossible beat filters that remove them:

- `requireParentSpan` on client instrumentations (DB, cache, HTTP clients)
- `requireParentforOutgoingSpans` on HTTP clients
- Ignoring framework middleware layer types
- An **allow-list** of traced routes on HTTP servers

### Allow-list, never deny-list

A deny-list fails **open**: every new asset, preflight or mistyped URL becomes a
trace by default. Match on the **pathname**, not the raw URL — a filter comparing
the raw URL against `/health` misses `/health?probe=1`. Pair **method with path**,
or you trace 404s on the right path with the wrong verb.

---

## 3. Suppression mechanics

**Remove the span, not the call.** The poll still happens; only its span goes.
Behaviour is unchanged.

Suppress **at the call site**, not at the exporter — nothing is allocated for a
no-op, and there is no config that can drift from the code.

- Use a **private context key** for suppression state.
- **Never** put it in baggage — baggage travels in plaintext headers to every
  downstream service.
- If a client's transport is fixed at construction, hold two clients (one traced,
  one plain) and select per call. Route every call through one helper so
  suppression cannot be half-applied.

### When call-site suppression is impossible

Third-party libraries that instrument themselves give you no call site. Only then,
use a **wrapping span processor** that withholds spans from the exporter.

- Filter by **instrumentation scope**, not span name — names are version-dependent
  and drift; the scope identifies the library.
- Filter at span end, not with a sampler — samplers aren't given the scope.
- **Before dropping a subtree, verify in real data that nothing outside it is
  parented to something inside it.** Otherwise you orphan what you meant to keep.

### Check for a native off-switch first — and verify it works

Libraries often expose an "observability disabled" option that nothing honours.
Confirm the flag is actually honoured in the installed version before relying on
it.

---

## 4. Traces vs logs vs metrics vs span events

| Signal | Answers | Shape |
|---|---|---|
| **Trace** | what happened, in what order, how long | duration + position in a tree |
| **Log** | narrative/diagnostics; the record that survives with no span | a point in time |
| **Metric** | how often / how many / how long, aggregated | cheap, no per-event detail |
| **Span event** | a moment *inside* an operation | timestamped, on a span, no duration |

**A span is not a log.** A span has duration and a parent. Not every log should be
a span — most logs happen *during* an operation, not *as* one, and promoting them
turns one readable trace into a flat 40-node tree. Use span events for those.

### Suppressing a span must NEVER suppress the log

For a run that found nothing, the log is the **only** evidence the code executed.
A failed check is the same: a failed status read belongs in the log stream, not in
a trace.

### Orphaned logs are correct; orphaned traces are not

State this explicitly whenever explaining the rules, or someone will "fix" the
unattached logs. A log with no trace id, emitted by a suppressed check, is correct
as designed.

---

## 5. Log-to-span correlation

Correlation rides on the **context**:

| Carries correlation | Does not |
|---|---|
| `slog.InfoContext(ctx, …)` | `slog.Info(…)` |
| a log call inside an active span | the same call with no span open |
| Node with a context manager registered | Node without one |

Dropping the context is a one-word edit, both forms look identical on the console,
and the loss surfaces only when someone opens the trace and finds the logs missing
— exactly when they needed them.

Assert **both** `trace_id` and `span_id`. A record with the trace but not the span
cannot be placed at a step within it.

Test correlation **through the redaction/enrichment stage**, since that is the
processor that rewrites records in flight and therefore where context plausibly
gets lost.

---

## 6. Trace continuation vs span links

### A trace is not an object

There is no trace object and no `startTrace()`. A trace is every span sharing a
`trace_id`; the root is the one with no parent.

### Attachment is the context, always

In-process, a span is a child **because it was started from the parent's
context**. Passing a fresh/background context silently creates a root — that is
how orphans are born.

Across a process boundary, serialise the context into the message or headers with
the propagator (`Inject` on the producer, `Extract` on the consumer). The wire
format is W3C `traceparent` — two short strings, not a serialised object, which is
why it works across languages.

**A span's parent is fixed at creation.** It cannot be re-parented later.

### Continue or link

| Situation | Shape |
|---|---|
| First delivery, valid context present | **Continue** — one trace end to end |
| Redelivery / retry | **New root + link** — the original trace already closed |
| Long human delay (email → click, days later) | **New root + link** |
| Clock-driven work (timer, cron) | **Root, no link** — nothing caused it |
| Fan-in (one batch, many causes) | **New root + link to each** |
| No context present | **Plain root**, record `trace_context.present=false` |

Prefer continuing when a message has exactly one consumer and the chain is short —
a handful of spans. Always-linking costs something concrete: one request becomes
two disconnected traces, and because log records take the trace id of the active
span, the producer's trace shows producer logs and nothing else.

Prefer new-root-plus-link when the causing span has already ended. Re-parenting
onto a finished span reopens it and stretches its duration across the entire gap.

### Two consumer-side subtleties

**Extract into a detached context.** Extracting onto the live context silently
makes the remote span your parent before you have decided whether it should be.

**When continuing, graft the remote span context onto the live context** — don't
adopt the extracted one. It was built from a background context and carries no
deadline or cancellation, so handing it to the handler makes the work
un-cancellable on shutdown.

### Span links

A link references another span's context, set **at creation**, expressing
causality without containment.

| | Parent | Link |
|---|---|---|
| How many | one (or none) | zero or many |
| Trace id | child joins parent's | linker keeps its own |
| Means | "I happened inside that" | "I was caused by that" |
| Cause's state | still open | usually finished |

**A link needs a COMPLETE span context** — a non-zero trace id *and* a non-zero
span id. SDKs silently discard a link whose context is invalid, and a discarded
link takes its attributes with it. If you persist causality for later linking,
persist **both** ids, and also store the trace id as a plain attribute so older
records keep their provenance.

Cost: you cannot retrieve the whole flow with one `trace_id` filter. Which is why
you also need —

### A correlation id that works across both shapes

Carry a flow-level id in **baggage** and stamp it onto every span as an attribute.
It stays constant whichever shape each hop chose, so one query spans continued and
linked chains alike.

Filter baggage to that key only. Baggage goes in plaintext headers to every
downstream service; a permissive filter is an exfiltration path.

### Trace context is optional forever

A consumer receiving no trace context starts a plain root, records that fact, and
processes normally. **Never reject or drop a message for missing telemetry
context** — services deploy independently and order is not guaranteed.

---

## 7. Attributes, resources, cardinality

Attributes are typed key/value pairs — the dimensions you filter and group by.
Follow semantic conventions so backends can interpret them.

**Resource attributes** describe the emitting process (`service.name`,
`deployment.environment`) and are identical across every signal from it. **Span
attributes** describe the operation.

Cardinality behaves differently per signal:

- On **spans**, high cardinality is fine and is the point. Put the entity id on.
- On **metrics**, every distinct attribute value is a new time series. Bound any
  producer-controlled value to a known set with an `other` catch-all. An unbounded
  metric label grows memory and export payloads without limit.

Also set **span kind** (Internal/Server/Client/Producer/Consumer) — backends use it
for service maps — and **span status** (Unset/Ok/Error), which is not the HTTP
status code.

---

## 8. Metrics

| Instrument | Use |
|---|---|
| **Counter** | monotonic — requests handled, cycles run |
| **UpDownCounter** | can decrease — queue depth, active connections |
| **Gauge** | sampled current value |
| **Histogram** | distribution → percentiles, e.g. latency |

**Aggregation temporality matters.** `delta` → summing is correct. `cumulative` →
the value is a running total, so summing double-counts; take the last value, or
`max - min` for a rate. Check or split by temporality whenever both can appear.

Metrics are cheap and pre-aggregated but lose per-request detail. That is exactly
why liveness lives in metrics and debugging lives in traces.

---

## 9. Credentials and sensitive data

**A bearer credential must never appear in a span attribute or a log line.**

This includes anything embedded in a URL path. A capability URL *is* the
credential — exported on a span it becomes a replayable link sitting in a
telemetry backend, readable by anyone with dashboard access and living under the
backend's retention rules rather than the data's.

**Automatic instrumentation has not read your rules.** Hand-written spans honour
the standard while auto-instrumentation records the request target verbatim. Audit
the **trace pipeline and the log pipeline separately** — different code paths, and
one having redaction says nothing about the other.

Mechanics:

- Redact in the hook where the span is **still writable**. Once a span has ended it
  is read-only; mutating its attribute map behind the SDK's back may reach the
  exporter today and stop working on an upgrade without telling you.
- Register the redactor **before** the exporter — processors run in order.
- Cover **every** attribute name the value might land on (`url.path`, `url.full`,
  `http.target`, `http.url`, `http.route`). Which one is populated depends on
  library version and on stable-vs-legacy semantic conventions; covering the
  obvious one still ships a credential.
- Preserve non-secret parts so the span still says what happened.
- Hash or derive at the **call site**, not in a log filter — a filter only covers
  the handlers you installed, and any other handler sees the raw value.

---

## 10. Testing

**Every suppression, redaction and gate needs a test that fails when the change is
reverted.** Verify by actually reverting it and watching the test fail for the
reason you expect.

Five ways these tests pass for the wrong reason — check each:

| Trap | Fix |
|---|---|
| Testing the helper, not the call site | Wrapping raw calls proves the helper works and still passes if someone deletes it from the real method. Drive the real method. |
| Testing a copy of the config | A test that builds its own options passes after the option is removed from production. Import the production constant. |
| Calling a processor hook on a hand-made object | Passes whether or not the processor is wired in. Build a real provider; assert on what the **exporter** received. |
| Asserting the property without the premise | "The trace id survived redaction" proves nothing if nothing was redacted. Assert the scrub happened first. |
| Vacuous by absence | "No span contains the secret" passes when no spans were emitted. Assert some were. |

Also:

- Test the error and repeat-initialisation paths, not just the happy first init —
  the repeat path is what every restart after the first takes.
- Where a filter is keyed on strings from a third-party library, assert those
  strings **against the library**. Every other test uses the same constants the
  filter does, so all of them pass with a wrong name — and with a wrong name the
  filter silently does nothing.
- Never let a test delete data it did not create. Skip instead, and use a
  dedicated test connection string, never the service's own.

---

## 11. Workflow

1. **Audit before changing.** Query the backend for single-span traces (orphans)
   and for spans-per-trace by service. Let the data name the target; don't guess.
2. **Classify each offender**: action / check / plumbing.
3. **Choose the fix**, in this order: call-site suppression → structural
   instrumentation option → wrapping processor (only if the first two are
   impossible).
4. **Build the counter first** if you are making a span conditional.
5. **Write the test, revert the fix, watch it fail.**
6. **Verify in the backend after deploy.** Tests passing is not evidence the noise
   stopped.

When reporting, distinguish clearly between fixed, deliberately declined (with the
reason recorded where a reviewer will see it), and already-addressed. Never
describe work as done while it is unmerged.

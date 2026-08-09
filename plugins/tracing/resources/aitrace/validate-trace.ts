/**
 * mastra-posthog — trace validation.
 *
 * Confirms that native PostHog AI traces are actually landing. Run this AFTER
 * you've exercised your agent at least once (so a trace exists), e.g.:
 *
 *   1) run your app once so it emits a trace, then
 *   2) POSTHOG_PERSONAL_API_KEY=phx_… POSTHOG_PROJECT_ID=12345 \
 *        npx tsx validate-trace.ts
 *
 * It reads back from PostHog (needs a personal API key, phx_…, + project id —
 * these are READ creds, distinct from the phc_ project token used to send).
 * No dependencies — uses global fetch (Node 18+).
 *
 * Exit code 0 = traces found (PASS), 1 = none found / misconfigured (FAIL).
 */
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const PERSONAL_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const INGEST_HOST = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';
const WINDOW_MINUTES = Number(process.env.MASTRAHOG_WINDOW_MINUTES ?? 30);

/** The query API lives on the app host (no `.i.`), e.g. eu.i.posthog.com → eu.posthog.com. */
function apiHost(ingest: string): string {
  if (process.env.POSTHOG_API_HOST) return process.env.POSTHOG_API_HOST;
  return ingest.replace('://eu.i.', '://eu.').replace('://us.i.', '://us.').replace('://app.i.', '://app.');
}

async function main(): Promise<void> {
  if (!PROJECT_ID || !PERSONAL_KEY) {
    console.error(
      'aitrace: set POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY (phx_…) to validate ingestion.\n' +
        'These are read-only credentials, separate from the phc_ project token used to send traces.',
    );
    process.exit(1);
  }
  if (!PERSONAL_KEY.startsWith('phx_')) {
    console.error('aitrace: POSTHOG_PERSONAL_API_KEY should be a personal API key (phx_…).');
    process.exit(1);
  }

  const url = `${apiHost(INGEST_HOST)}/api/projects/${PROJECT_ID}/query/`;
  const query = {
    kind: 'HogQLQuery',
    query:
      "SELECT properties.$ai_model AS model, count() AS generations, " +
      "countIf(properties.$ai_is_error = true) AS errors, max(timestamp) AS latest " +
      `FROM events WHERE event = '$ai_generation' AND timestamp > now() - INTERVAL ${WINDOW_MINUTES} MINUTE ` +
      'GROUP BY model ORDER BY generations DESC',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PERSONAL_KEY}`, 'Content-Type': 'application/json' },
    // force_blocking: PostHog caches query results by query text — a validator
    // must always recompute, or a stale empty cache yields false negatives.
    body: JSON.stringify({ query, refresh: 'force_blocking' }),
  });

  if (!res.ok) {
    console.error(`aitrace: PostHog query failed (HTTP ${res.status}). Check project id + personal key + host.`);
    console.error((await res.text()).slice(0, 400));
    process.exit(1);
  }

  const data = (await res.json()) as { results?: Array<[string, number, number, string]> };
  const rows = data.results ?? [];

  if (rows.length === 0) {
    console.error(
      `aitrace: FAIL — no $ai_generation events in the last ${WINDOW_MINUTES}m.\n` +
        'Did the agent actually run? Is observability wired into the Mastra instance?\n' +
        'Is POSTHOG_HOST the region your project lives in (eu vs us)?',
    );
    process.exit(1);
  }

  const totalGens = rows.reduce((s, r) => s + Number(r[1]), 0);
  const totalErrs = rows.reduce((s, r) => s + Number(r[2]), 0);
  console.log(`aitrace: PASS — ${totalGens} generation(s) reaching PostHog in the last ${WINDOW_MINUTES}m.`);
  for (const [model, gens, errs, latest] of rows) {
    console.log(`  • ${model}: ${gens} generation(s), ${errs} error(s), latest ${latest}`);
  }
  console.log(`Errors flagged on traces: ${totalErrs}. View: AI engineering → Traces / Errors.`);
}

main().catch((err) => {
  console.error('aitrace: validation crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

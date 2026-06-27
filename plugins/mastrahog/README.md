# mastrahog — Mastra × PostHog

Drop-in, **validated** native PostHog AI observability for Mastra agents. Call the
skill, get correct `$ai_*` tracing wired in, and have it proven end-to-end — no
need to learn the `@mastra/posthog` internals yourself.

The first skill is tracing; the ecosystem grows from there (analytics, feedback,
logs as separate `mastrahog:*` skills later).

## Skills

- `/mastrahog:aitrace` — wire native PostHog AI tracing into a Mastra TypeScript
  project and validate it. Installs `@mastra/observability` + `@mastra/posthog`,
  drops in the master code (`buildPostHogObservability()` + `withUser()` helpers),
  wires it into your `Mastra` instance, sets env, then runs the agent and reads
  the traces back from PostHog to confirm they're landing.

  Covers: native tracing, generations, users, sessions, errors, and live
  evaluations. **Tool calling is a known upstream gap** (`@mastra/posthog` exports
  trace metadata only, not tool-call payloads) — the skill says so plainly rather
  than faking a populated Tools tab.

`/mastrahog:aitrace` fires when you ask to add/instrument PostHog tracing on a
Mastra app, or invoke it explicitly.

## Install

From the `ai-skills` marketplace:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install mastrahog@ai-skills
```

Restart Claude Code so the new slash command registers.

## Update

```
/plugin marketplace update ai-skills
/plugin update mastrahog@ai-skills
```

## Uninstall

```
/plugin uninstall mastrahog@ai-skills
```

## What it needs

- A Mastra (TypeScript) project (`@mastra/core`).
- A PostHog **project** token (`phc_…`) and your region host
  (`https://eu.i.posthog.com` / `https://us.i.posthog.com` / self-host).
- For the validation read-back: a personal API key (`phx_…`) + project id
  (optional — without it the skill tells you to verify in the PostHog UI).

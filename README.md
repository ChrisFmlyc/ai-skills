# ai-skills

Personal Claude Code marketplace for managing and deploying skills across work and personal environments.

This repository is a [Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugins) — it bundles plugins (collections of skills, agents, commands, and hooks) so they can be installed in any Claude Code environment with a single command.

> **Agents:** see [`AGENTS.md`](./AGENTS.md) for the maintenance rules and the per-platform install procedure you should follow when a human asks you to deploy these skills.

## What's in here

| Plugin | Description |
|--------|-------------|
| [`codereview`](./plugins/codereview) | Personal CodeRabbit helpers — single and batched finding fix flows, plus `/codereview:loop` to drive a PR to zero outstanding findings. |
| [`tracing`](./plugins/tracing) | PostHog observability, drop-in and validated. `/tracing:aitrace` wires native PostHog AI tracing (`$ai_*`) into a Mastra app — connector, users/sessions, errors, confirmed landing. `/tracing:oteltrace` instruments any app in any language with OpenTelemetry logs + distributed traces to PostHog, governed by a bundled OTel standard (spans only for real actions, no orphans, redaction on both pipelines, a test per gate). |
| [`repo`](./plugins/repo) | Repo lifecycle: bootstrap (`/repo:init`), sync (`/repo:sync`), create branch (`/repo:newbranch`), validate (`/repo:branch`). |

## Install (humans — Claude Code)

Claude Code is the primary target. Add the marketplace once, then install whichever plugins you want:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install codereview@ai-skills
```

Restart Claude Code so new slash commands register. After install, `/codereview:single` and `/codereview:multi` are available.

## Update

```
/plugin marketplace update ai-skills
/plugin update codereview@ai-skills
```

## Uninstall

```
/plugin uninstall codereview@ai-skills
/plugin marketplace remove ai-skills
```

## Other platforms

The same `SKILL.md` files work in other agent environments (Claude Desktop, Claude Agent SDK, Codex, Cursor), but the install procedure differs. Rather than maintain a parallel set of human instructions per platform, ask your agent: *"Install the ai-skills `<plugin>` plugin"* and it will read [`AGENTS.md`](./AGENTS.md) and follow the right procedure for the platform it's running on.

## Repository layout

```
ai-skills/
├── .claude-plugin/
│   └── marketplace.json        # marketplace manifest (registers each plugin)
├── plugins/
│   └── <plugin>/
│       ├── .claude-plugin/
│       │   └── plugin.json     # plugin manifest
│       ├── README.md
│       └── skills/
│           └── <skill>/
│               └── SKILL.md    # skill body with YAML frontmatter
├── AGENTS.md                   # instructions for agents
└── README.md
```

Each plugin follows the skill-creator `SKILL.md` layout, so individual skill files are portable to any agent that understands the format.

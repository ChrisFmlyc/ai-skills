# ai-skills

Personal Claude Code marketplace for managing and deploying skills across work and personal environments.

This repository is a [Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugins) — it bundles plugins (collections of skills, agents, commands, and hooks) so they can be installed in any Claude Code environment with a single command.

> **Agents:** see [`AGENTS.md`](./AGENTS.md) for the maintenance rules and the per-platform install procedure you should follow when a human asks you to deploy these skills.

## What's in here

| Plugin | Description |
|--------|-------------|
| [`crx`](./plugins/crx) | Personal CodeRabbit helpers — single and batched finding fix flows, plus `/crx:loop` to drive a PR to zero outstanding findings. |
| [`repo`](./plugins/repo) | Repo lifecycle: bootstrap (`/repo:init`), sync (`/repo:sync`), create branch (`/repo:newbranch`), validate (`/repo:branch`). |

## Install (humans — Claude Code)

Claude Code is the primary target. Add the marketplace once, then install whichever plugins you want:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install crx@ai-skills
```

Restart Claude Code so new slash commands register. After install, `/crx:single` and `/crx:multi` are available.

## Update

```
/plugin marketplace update ai-skills
/plugin update crx@ai-skills
```

## Uninstall

```
/plugin uninstall crx@ai-skills
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

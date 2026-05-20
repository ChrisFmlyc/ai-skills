# AGENTS.md

Instructions for AI agents working with this repository.

## What this repo is

`ai-skills` is a personal Claude Code plugin marketplace. It is the single source of truth for the human's skills across work and personal machines. Every plugin in `plugins/` is intended to be installable in any agent environment (Claude Code, Claude Desktop, Claude Agent SDK, Codex, Cursor) by following the per-platform procedure below.

You will be asked to do two kinds of work in this repo:

1. **Maintenance** — add a new skill, edit an existing one, bump a version. Follow the maintenance rules in the next section.
2. **Deployment** — install one of these skills on the current machine. Detect which agent platform you are running on and follow the matching install procedure below.

## Maintenance rules (read before editing)

These rules are non-negotiable. If a request would violate one, stop and explain why before proceeding.

### When adding a new skill to an existing plugin

1. Create `plugins/<plugin>/skills/<skill>/SKILL.md` with YAML frontmatter:
   ```yaml
   ---
   name: <skill>
   description: <one sentence describing when this skill should trigger — Claude matches against this>
   metadata:
     version: "0.1.0"
     triggers:
       - "<optional literal phrase that auto-triggers the skill>"
   ---
   ```
2. Bump `version` in `plugins/<plugin>/.claude-plugin/plugin.json`.
3. If the new skill is user-visible enough to mention, update `plugins/<plugin>/README.md`.
4. If the plugin gained materially new functionality, update the top-level `README.md` "What's in here" table description.

### When adding a brand-new plugin

1. Create the directory tree:
   ```
   plugins/<plugin>/
   ├── .claude-plugin/plugin.json
   ├── README.md
   └── skills/<skill>/SKILL.md
   ```
2. Write `plugin.json` with `name`, `description`, `version` (start at `0.1.0`), and `author`.
3. **Register the plugin in `.claude-plugin/marketplace.json`** under `plugins`. The marketplace will not surface it otherwise.
4. **Add a row to the "What's in here" table in the top-level `README.md`.** If you skip this step the human will not know the plugin exists.
5. Add the per-plugin `README.md` with install/update/uninstall snippets pointing at this marketplace.

### When editing or removing a skill

- Edits: bump `version` in the affected plugin's `plugin.json`.
- Removals: delete the skill directory, bump the plugin version, and update both READMEs if the skill was listed.

### Commit & PR conventions

- Branch per change. Never commit directly to `main`.
- Conventional commit prefix: `feat(<plugin>):`, `fix(<plugin>):`, `chore:`, `docs:`.
- Open a PR so CodeRabbit can review. Do not push to `main` without one.
- Never use `--no-verify` or `--no-gpg-sign`.

### Things to avoid

- Do **not** put `agents/`, `commands/`, `skills/`, or `hooks/` inside `.claude-plugin/`. Only `plugin.json` lives there. Skills go in `plugins/<plugin>/skills/<skill>/SKILL.md`.
- Do **not** invent install paths for platforms not documented below. If a human asks about an unlisted platform, say you do not know the current install procedure and ask them to point you at the platform's docs.
- Do **not** commit `.claude/settings.local.json`, `.DS_Store`, or any file containing secrets.

## Deployment — per-platform install procedures

Detect the platform first. Indicators:

- **Claude Code (CLI):** you have `Bash`, `Edit`, `Read`, etc.; `~/.claude/` exists; the user runs you in a terminal.
- **Claude Desktop / claude.ai web:** you are operating through the consumer UI; no shell access.
- **Claude Agent SDK:** you are embedded in another application via the SDK.
- **Codex (OpenAI CLI):** OpenAI's coding CLI; reads `AGENTS.md` natively.
- **Cursor:** Cursor IDE; rules live under `.cursor/rules/`.

If you cannot determine the platform, ask the human.

### Claude Code (CLI)

Preferred path — use the marketplace:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install <plugin>@ai-skills
```

Then ask the human to restart Claude Code so the new slash commands register.

Fallback (manual, for offline or air-gapped machines):

```bash
git clone git@github.com:ChrisFmlyc/ai-skills.git ~/code/ai-skills
mkdir -p ~/.claude/skills
ln -s ~/code/ai-skills/plugins/<plugin>/skills/<skill> ~/.claude/skills/<skill>
```

User-level skills resolve from `~/.claude/skills/<name>/SKILL.md`. Project-level skills go in `<project>/.claude/skills/<name>/SKILL.md`.

### Claude Desktop / claude.ai web

There is no CLI. The human installs through the UI:

1. Settings → Capabilities → Skills.
2. Upload the skill as a ZIP whose root is a single folder containing `SKILL.md`.

Your job as the agent is to produce the ZIP:

```bash
cd ~/code/ai-skills/plugins/<plugin>/skills
zip -r /tmp/<skill>.zip <skill>
```

Hand `/tmp/<skill>.zip` to the human and tell them to upload it via the Skills UI. Do not attempt to upload it yourself.

### Claude Agent SDK

Skills load from `~/.claude/skills/` and `<cwd>/.claude/skills/` only when the SDK is configured to read them:

- TypeScript: `query({ ..., settingSources: ['user', 'project'] })`
- Python: `query(..., setting_sources=["user", "project"])`

Install procedure: same as Claude Code (clone + symlink into `~/.claude/skills/`). Then make sure the embedding application sets `settingSources`. If you do not control that code, surface the requirement to the human and stop.

### Codex (OpenAI CLI)

Codex has no `~/.codex/skills/` directory and no plugin marketplace as of early 2026. To use a skill from this repo with Codex:

1. Clone the repo: `git clone git@github.com:ChrisFmlyc/ai-skills.git`.
2. Reference the desired `SKILL.md` from the project's `AGENTS.md`. Either:
   - Add an `@include` / link pointing at the SKILL.md path, or
   - Inline the skill's instruction body into `AGENTS.md` under a clear heading.

This is a lossy port — Codex does not have the same triggering / auto-invocation semantics as Claude Code. The skill becomes part of the always-on instructions, not an on-demand capability. Flag this to the human before doing it.

### Cursor

Cursor supports SKILL.md-style files and a rules system under `.cursor/rules/<name>.mdc`. Install:

1. Clone the repo.
2. For each desired skill, copy `plugins/<plugin>/skills/<skill>/SKILL.md` to `<project>/.cursor/rules/<skill>.mdc`. Preserve the YAML frontmatter.
3. If the skill's body references commands or paths specific to Claude Code (like `/plugin`), call that out — they will not work in Cursor.

Cursor's plugin ecosystem is still maturing. Test the skill in a throwaway file before recommending it for daily use.

### Unlisted platforms

Do not guess. Ask the human for the install procedure or the platform's docs URL, then update this AGENTS.md as part of the same PR so the next agent has it.

## Quick reference — file locations

| What | Path |
|------|------|
| Marketplace manifest | `.claude-plugin/marketplace.json` |
| Plugin manifest | `plugins/<plugin>/.claude-plugin/plugin.json` |
| Skill body | `plugins/<plugin>/skills/<skill>/SKILL.md` |
| Per-plugin docs | `plugins/<plugin>/README.md` |
| Human-facing docs | `README.md` |
| Agent-facing docs | `AGENTS.md` (this file) |

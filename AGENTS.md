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
   description: <when to invoke it, what it does, and what it never does>
   metadata:
     version: "0.1.0"
   ---
   ```

   `description` is the only field Claude reads when deciding whether to load the
   skill, so everything that governs invocation has to be in it. Two or three
   sentences: **Invoke when X. It does Y. It never does Z.** The closing boundary
   is what stops skills in the same plugin being confused for each other.

   Do **not** add a `metadata.triggers` list. `metadata` is a free-form map that
   Claude Code never reads, so trigger phrases parked there never fire. If a
   literal phrase matters, put it in `description`.

   Set `disable-model-invocation: true` only for a skill that must never start on
   its own. It also keeps the description out of context entirely, so the skill
   becomes reachable by slash command alone.
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

- Branch per change. Never commit directly to `main`. `/repo:branch` enforces this.
- Conventional commit prefix, such as `feat(<plugin>):`, `fix(<plugin>):` or `docs:`. `/repo:pr` has the full type list.
- Open a PR so CodeRabbit can review. Do not push to `main` without one.
- Run `/repo:pr` on the draft title and body before opening the PR. It owns the house style for both, and it needs the `/unslop` skill installed.
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

Codex reads this repo's `.claude-plugin/marketplace.json`, so it installs from the same marketplace:

```
codex plugin marketplace add ChrisFmlyc/ai-skills
codex plugin add <plugin>@ai-skills
```

Update later with `codex plugin marketplace upgrade ai-skills`. On an offline or air-gapped machine, clone the repo and pass its path instead: `codex plugin marketplace add ~/code/ai-skills`.

**A plugin's hooks do not run until the human trusts them.** Codex skips an untrusted hook, and `codex exec` gives no sign that it did. This matters for `repo`: until its branch-policy hook is trusted, `/repo:branch` is instructions only in Codex. After installing `repo`, ask the human to open the `codex` TUI, run `/hooks`, and trust the `repo@ai-skills` PreToolUse hook. Any change to the plugin's files, an upgrade or any other edit, marks the hook modified, and it stops running until it is trusted again. Upgrades are the usual cause, so ask again after every upgrade, and after any other edit to the plugin's files. The trust decision is the human's: never write it into `~/.codex/config.toml` for them, and never pass `--dangerously-bypass-hook-trust`.

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

# AGENTS.md

Instructions for AI agents working with this repository.

## What this repo is

`ai-skills` is a personal Claude Code plugin marketplace. It is the single source of truth for the human's skills across work and personal machines. Every plugin in `plugins/` installs whole in Claude Code and Codex, and its skills install one by one in Claude Desktop, the Claude Agent SDK and Cursor, subject to the single-skill rules in § Deployment.

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

### Writing skills and agent docs

Every file an agent reads is written green-field, as if fresh, so it carries its rules at the highest fidelity. That covers skills, their bundled resources, `AGENTS.md` and the READMEs.

- State each rule once, in positive terms, as the correct behaviour, in the one place it belongs. Everywhere else, point to it.
- When a rule is wrong, rewrite or delete that line. A wrong "always use a VPN" is removed, never answered by a second sentence that undoes, softens, overrides or excepts it.
- Write the current behaviour only: no history of fixes ("now", "no longer", "previously") and no denial of something nothing asked for.
- A condition that belongs to a rule sits inside that rule. Cases that differ read as one list or table.
- When two passages disagree, settle which is right and keep only that one.
- After an edit, re-read the whole file, and every file that restates the same contract, for these faults.

### When changing a GitHub or GitLab path

`codereview` drives GitHub pull requests through `gh` and GitLab merge requests through `glab`, and the `repo` skills that touch a forge serve the same two hosts. A change to one host's flow — host detection, the guardrail checks, thread listing, reply and resolve, the wait for a review, the push — is weighed for the other host in the same PR. Make the matching change where the other host has that step. Where it has none, the PR description names the host and says why.

Shell snippets in `codereview` that are tagged `<!-- snippet-test: <name> -->` run against recorded output in `plugins/codereview/tests/fixtures/`. Run `plugins/codereview/tests/snippets.sh` after changing one, and add or update a case for the changed behaviour on each host.

### Commit & PR conventions

- Branch per change. Never commit directly to `main`. `/repo:branch` enforces this.
- Conventional commit prefix, such as `feat(<plugin>):`, `fix(<plugin>):` or `docs:`. `/repo:pr` has the full type list.
- Open a PR so CodeRabbit can review. Do not push to `main` without one.
- Run `/repo:pr` on the draft title and body before opening the PR. It owns the house style for both, and it needs the `/unslop` skill installed.
- Never use `--no-verify` or `--no-gpg-sign`.

### Things to avoid

- Do **not** put `agents/`, `commands/`, `skills/`, or `hooks/` inside `.claude-plugin/`. Only `plugin.json` lives there. Skills go in `plugins/<plugin>/skills/<skill>/SKILL.md`.
- Do **not** commit `.claude/settings.local.json`, `.DS_Store`, or any file containing secrets.

## Deployment — per-platform install procedures

Detect the platform first. Indicators:

- **Claude Code (CLI):** you have `Bash`, `Edit`, `Read`, etc.; `~/.claude/` exists; the user runs you in a terminal.
- **Claude Desktop / claude.ai web:** you are operating through the consumer UI; no shell access.
- **Claude Agent SDK:** you are embedded in another application via the SDK.
- **Codex (OpenAI CLI):** OpenAI's coding CLI; reads `AGENTS.md` natively.
- **Cursor:** Cursor IDE; skills live under `.cursor/skills/`.

If you cannot determine the platform, ask the human.

A plugin install puts the whole plugin on disk: the Claude Code marketplace or Codex. The single-skill routes — the Claude Code manual fallback, the Claude Agent SDK, Claude Desktop and Cursor — install skill folders one at a time, under these rules:

- **Plugin-install rule.** A skill that reads `${CLAUDE_PLUGIN_ROOT}`, such as either `tracing` skill, uses files elsewhere in its plugin, so it needs a plugin install. A single-skill route takes only a skill whose files all sit inside its own folder or a companion's.
- **Companion skills.** A skill that calls another skill of its plugin, or follows one of that skill's files, needs that skill installed beside it. Each route installs a skill's companions below with it:

  | Skill | Companion | Why |
  |-------|-----------|-----|
  | `codereview/loop` | `codereview/fix` | `loop` hands every open finding to `/codereview:fix` |
  | `codereview/fix` | `codereview/loop` | on GitLab, `fix` reads the bot list as `loop`'s `reference/gitlab-bots.md` says |
  | `repo/newbranch` | `repo/branch` | `newbranch` validates every branch name with `/repo:branch` |

- **Existing skill folders.** A route that writes the skill folder to disk — the Claude Code fallback, the Claude Agent SDK and Cursor — checks the target path first, and its command refuses when a folder, file or link of that name is already there. Ask the human before replacing it; on a yes, remove it and run the command again.

### Claude Code (CLI)

Preferred path — use the marketplace:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install <plugin>@ai-skills
```

Then ask the human to restart Claude Code so the new slash commands register.

Fallback (manual, for offline or air-gapped machines; a single-skill route under the rules above). Clone the repo, or use an existing clone:

```bash
git clone https://github.com/ChrisFmlyc/ai-skills.git "$HOME/code/ai-skills"
```

Then link each skill, companions included, into `~/.claude/skills`. Replace `<clone>` with the clone's absolute path, such as `$HOME/code/ai-skills`:

```bash
mkdir -p "$HOME/.claude/skills" &&
  if [ -e "$HOME/.claude/skills/<skill>" ] || [ -L "$HOME/.claude/skills/<skill>" ]; then
    echo "$HOME/.claude/skills/<skill> exists: ask the human before replacing it" >&2
    false
  else
    ln -s "<clone>/plugins/<plugin>/skills/<skill>" "$HOME/.claude/skills/<skill>"
  fi
```

User-level skills resolve from `~/.claude/skills/<name>/SKILL.md`. Project-level skills go in `<project>/.claude/skills/<name>/SKILL.md`.

### Claude Desktop / claude.ai web

There is no CLI. The human installs through the UI:

1. Settings → Capabilities → Skills.
2. Upload the skill as a ZIP whose root is a single folder containing `SKILL.md`.

This is a single-skill route under the rules above; the commands below stop for a skill that needs a plugin install.

Give the human these commands to build the ZIP for each skill, companions included, from their clone of this repo, made with the `git clone` command in the Claude Code fallback above if they have none. Replace `<clone>` with the clone's absolute path, such as `$HOME/code/ai-skills`:

```bash
cd "<clone>/plugins/<plugin>/skills" &&
  rm -f "/tmp/<skill>.zip" &&
  if grep -rq 'CLAUDE_PLUGIN_ROOT' "<skill>"; then
    echo "<skill> reads files outside its folder: install the <plugin> plugin instead" >&2
    false
  else
    zip -r "/tmp/<skill>.zip" "<skill>"
  fi
```

Then tell them to upload `/tmp/<skill>.zip` via the Skills UI. Do not attempt to upload it yourself.

### Claude Agent SDK

Skills load from `~/.claude/skills/` and `<cwd>/.claude/skills/` only when the SDK is configured to read them:

- TypeScript: `query({ ..., settingSources: ['user', 'project'] })`
- Python: `query(..., setting_sources=["user", "project"])`

Install procedure: same as the Claude Code fallback (clone + symlink into `~/.claude/skills/`), a single-skill route under the rules above. Then make sure the embedding application sets `settingSources`. If you do not control that code, surface the requirement to the human and stop.

### Codex (OpenAI CLI)

Codex reads this repo's `.claude-plugin/marketplace.json`, so it installs from the same marketplace:

```
codex plugin marketplace add ChrisFmlyc/ai-skills
codex plugin add <plugin>@ai-skills
```

Update later with `codex plugin marketplace upgrade ai-skills`. On an offline or air-gapped machine, clone the repo and pass its path instead: `codex plugin marketplace add ~/code/ai-skills`.

**A plugin's hooks do not run until the human trusts them.** Codex skips an untrusted hook, and `codex exec` gives no sign that it did. This matters for `repo`: until its branch-policy hook is trusted, `/repo:branch` is instructions only in Codex. Any change to the plugin's files, an upgrade included, marks the hook modified, and it stops running until it is trusted again. So after installing `repo`, and again after every upgrade or other edit to its files, ask the human to open the `codex` TUI, run `/hooks`, and trust the `repo@ai-skills` PreToolUse hook. The trust decision is the human's: never write it into `~/.codex/config.toml` for them, and never pass `--dangerously-bypass-hook-trust`.

### Cursor

Cursor loads Agent Skills: each skill is a folder holding `SKILL.md`, found under `<project>/.cursor/skills/` for one project or `~/.cursor/skills/` for every project, and the skill reads the other files in that folder by paths relative to it. Install:

1. Clone the repo with the `git clone` command in the Claude Code fallback above, or use an existing clone.
2. For each desired skill, companions included, within the rules above (this is a single-skill route), copy the whole skill folder, with `SKILL.md` and every file and subfolder beside it, into a skills directory. Keep the folder's name, which Cursor requires to match the `name` in the skill's frontmatter. Replace `<clone>` with the clone's absolute path and `<skills>` with `<project>/.cursor/skills` or `$HOME/.cursor/skills`:

   ```bash
   mkdir -p "<skills>" &&
     if [ -e "<skills>/<skill>" ] || [ -L "<skills>/<skill>" ]; then
       echo "<skills>/<skill> exists: ask the human before replacing it" >&2
       false
     else
       cp -R "<clone>/plugins/<plugin>/skills/<skill>" "<skills>/<skill>"
     fi
   ```
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

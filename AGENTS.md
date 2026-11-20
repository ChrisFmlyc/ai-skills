# AGENTS.md

Instructions for AI agents working with this repository.

## What this repo is

`ai-skills` is a personal Claude Code plugin marketplace. It is the single source of truth for the human's skills across work and personal machines. Every plugin in `plugins/` installs whole in Claude Code, Codex and the Claude Agent SDK, and its skills install one by one in Claude Desktop and Cursor, subject to the plugin-install rule in § Deployment.

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

Claude Code, Codex and the Claude Agent SDK install a plugin whole: its skills, hooks and every other file go on disk together, and Claude Code and the SDK name its skills `/<plugin>:<skill>`. Claude Desktop and Cursor install skill folders one at a time, and a skill installed as its own folder carries no plugin name: it runs as `/<skill>`. These two single-skill routes follow the plugin-install rule.

**Plugin-install rule.** A skill that reads `${CLAUDE_PLUGIN_ROOT}`, or calls another skill by its plugin-qualified name `/<plugin>:<skill>` or follows one of that skill's files, needs a plugin install: only a plugin install puts the plugin's other files on disk and gives its skills those names. This list holds every such skill, and a single-skill route takes every skill it leaves out. The Claude Desktop commands find the list by its header row and read its skill rows, so the header row stays as written and the change that brings a skill under this rule adds its row:

| Skill | Why it needs a plugin install |
|-------|-------------------------------|
| `codereview/fix` | on GitLab, it reads the bot list as `/codereview:loop`'s `reference/gitlab-bots.md` says |
| `codereview/loop` | it hands every open finding to `/codereview:fix` |
| `repo/newbranch` | it validates every branch name with `/repo:branch` |
| `tracing/aitrace` | it reads `${CLAUDE_PLUGIN_ROOT}/resources/aitrace/` |
| `tracing/oteltrace` | it reads `${CLAUDE_PLUGIN_ROOT}/resources/oteltrace/` |

Every route except an online marketplace install works from a clone of this repo. Use an existing clone, or make one:

```bash
git clone https://github.com/ChrisFmlyc/ai-skills.git "$HOME/code/ai-skills"
```

`<clone>` below stands for the clone's absolute path written out in full, such as `/home/you/code/ai-skills`: the `/plugin` command and the SDK options receive it with no shell to expand `$HOME` or `~`.

### Claude Code (CLI)

Install from the marketplace:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install <plugin>@ai-skills
```

On an offline or air-gapped machine, add the marketplace from the clone instead: `/plugin marketplace add <clone>`.

Then ask the human to restart Claude Code so the new slash commands register.

### Claude Desktop / claude.ai web

There is no CLI. The human installs through the UI:

1. Settings → Capabilities → Skills.
2. Upload the skill as a ZIP whose root is a single folder containing `SKILL.md`.

This is a single-skill route. Give the human these commands to build the ZIP for each skill from their clone, brought up to date with `git -C "<clone>" pull`. They read the plugin-install list from the clone's `AGENTS.md` and build the ZIP only for a skill the list leaves out; they stop for a skill on the list, and for any skill when the list is missing or cannot be read:

```bash
cd "<clone>/plugins/<plugin>/skills" &&
  rm -f "/tmp/<skill>.zip" &&
  { grep -q '^ *| Skill | Why it needs a plugin install |' "<clone>/AGENTS.md"; has_list=$?; } &&
  { grep -q '^ *| `<plugin>/<skill>` |' "<clone>/AGENTS.md"; listed=$?; } &&
  case $has_list$listed in
    00) echo "<skill> needs a plugin install: install the <plugin> plugin instead" >&2
        false ;;
    01) zip -r "/tmp/<skill>.zip" "<skill>" ;;
    1?) echo "no plugin-install list in <clone>/AGENTS.md: update the clone with git -C \"<clone>\" pull, then run this again" >&2
        false ;;
    *) echo "cannot read the plugin-install list in <clone>/AGENTS.md: no ZIP built" >&2
       false ;;
  esac
```

Then tell them to upload `/tmp/<skill>.zip` via the Skills UI. Do not attempt to upload it yourself.

### Claude Agent SDK

The SDK loads a whole plugin from a local path through its `plugins` option. Point it at the plugin in the clone:

- TypeScript: `query({ prompt, options: { plugins: [{ type: "local", path: "<clone>/plugins/<plugin>" }] } })`
- Python: `query(prompt=prompt, options=ClaudeAgentOptions(plugins=[{"type": "local", "path": "<clone>/plugins/<plugin>"}]))`

The SDK skips a path that does not exist and carries on, so check that the plugin is in the `plugins` list of the session's `init` message. If you do not control the embedding application's code, surface the requirement to the human and stop.

### Codex (OpenAI CLI)

Codex reads this repo's `.claude-plugin/marketplace.json`, so it installs from the same marketplace:

```
codex plugin marketplace add ChrisFmlyc/ai-skills
codex plugin add <plugin>@ai-skills
```

Update later with `codex plugin marketplace upgrade ai-skills`. On an offline or air-gapped machine, add the marketplace from the clone instead: `codex plugin marketplace add <clone>`.

**A plugin's hooks do not run until the human trusts them.** Codex skips an untrusted hook, and `codex exec` gives no sign that it did. This matters for `repo`: until its branch-policy hook is trusted, `/repo:branch` is instructions only in Codex. Any change to the plugin's files, an upgrade included, marks the hook modified, and it stops running until it is trusted again. So after installing `repo`, and again after every upgrade or other edit to its files, ask the human to open the `codex` TUI, run `/hooks`, and trust the `repo@ai-skills` PreToolUse hook. The trust decision is the human's: never write it into `~/.codex/config.toml` for them, and never pass `--dangerously-bypass-hook-trust`.

### Cursor

Cursor loads Agent Skills: each skill is a folder holding `SKILL.md`, found under `<project>/.cursor/skills/` for one project or `~/.cursor/skills/` for every project, and the skill reads the other files in that folder by paths relative to it. Install:

1. For each desired skill outside the plugin-install list above (this is a single-skill route), copy the whole skill folder from the clone, with `SKILL.md` and every file and subfolder beside it, into a skills directory. Keep the folder's name, which Cursor requires to match the `name` in the skill's frontmatter. Replace `<skills>` with `<project>/.cursor/skills` or `$HOME/.cursor/skills`:

   ```bash
   mkdir -p "<skills>" &&
     if [ -e "<skills>/<skill>" ] || [ -L "<skills>/<skill>" ]; then
       echo "<skills>/<skill> exists: ask the human before replacing it" >&2
       false
     else
       cp -R "<clone>/plugins/<plugin>/skills/<skill>" "<skills>/<skill>"
     fi
   ```

   The command refuses when a folder, file or link of that name is already there. Ask the human before replacing it; on a yes, remove it and run the command again.
2. If the skill's body references commands or paths specific to Claude Code (like `/plugin`), call that out — they will not work in Cursor.

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

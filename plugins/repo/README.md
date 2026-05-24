# repo — personal repo workflow helpers

Four skills, one repo lifecycle:

- `/repo:init` — bootstrap a brand-new repo **in the current directory** (never in a new wrapper folder). Commits a placeholder `README.md`, wires `origin` (creating the GitHub repo if you ask), pushes `main`.
- `/repo:sync` — post-merge git reset. Switches to the default branch, fetches with prune, fast-forwards to origin, and deletes the just-merged local feature branch. Slash-only; never auto-fires.
- `/repo:newbranch` — start a new piece of work. Runs `/repo:sync` first, takes a one-line description, proposes a `<prefix>/<slug>` branch name (confirms via AskUserQuestion: accept / regenerate / type your own), then creates a worktree at `../<repo>-worktrees/<prefix>-<slug>`. Slash-only.
- `/repo:branch` — branch-policy enforcement guardrail. **Auto-fires on any branch creation, worktree creation, or commit verb.** Refuses commits on `main`/`master` and refuses branch names that don't match one of the required prefixes (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `rnd/`, `hotfix/`). No bypasses.

`/repo:init` and `/repo:branch` auto-trigger when their associated verbs appear in the conversation. `/repo:sync` and `/repo:newbranch` only fire when invoked explicitly.

## Install

From the `ai-skills` marketplace:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install repo@ai-skills
```

Restart Claude Code so the new slash commands register.

## Update

```
/plugin marketplace update ai-skills
/plugin update repo@ai-skills
```

## Uninstall

```
/plugin uninstall repo@ai-skills
```

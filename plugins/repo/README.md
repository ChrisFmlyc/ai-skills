# repo — personal repo workflow helpers

Two skills:

- `/repo:init` — bootstrap a brand-new repo **in the current directory** (never in a new wrapper folder). Commits a placeholder `README.md`, wires `origin` (creating the GitHub repo if you ask), pushes `main`.
- `/repo:branch` — branch-policy enforcement guardrail. **Auto-fires on any branch creation, worktree creation, or commit verb.** Refuses commits on `main`/`master` and refuses branch names that don't match one of the required prefixes (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `rnd/`, `hotfix/`). No bypasses.

Either skill auto-triggers when its associated verb appears in the conversation, or invoke explicitly with `/repo:init` / `/repo:branch`.

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

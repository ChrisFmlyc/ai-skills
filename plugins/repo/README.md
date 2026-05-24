# repo — personal repo workflow helpers

One skill today, more on the way:

- `/repo:init` — bootstrap a brand-new repo **in the current directory** (never in a new wrapper folder). Commits a placeholder `README.md`, wires `origin` (creating the GitHub repo if you ask), pushes `main`.

Auto-triggers on phrases like "init this as a new repo" / "set up a new repo here", or invoke explicitly with `/repo:init`.

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

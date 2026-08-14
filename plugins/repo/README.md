# repo — personal repo workflow helpers

Five skills, one repo lifecycle:

- `/repo:init` — bootstrap a brand-new repo **in the current directory** (never in a new wrapper folder). Commits a placeholder `README.md`, wires `origin` (creating the GitHub repo if you ask), pushes `main`.
- `/repo:sync` — post-merge git reset. Switches to the default branch, fetches with prune, fast-forwards to origin, and deletes the just-merged local feature branch. Aborts on a dirty tree or a detached HEAD, and warns instead of deleting a branch holding more local commits than a squash-merge would explain.
- `/repo:newbranch` — start a new piece of work. Runs `/repo:sync` first, takes a one-line description, proposes a `<prefix>/<slug>` branch name (confirms via AskUserQuestion: accept / regenerate / type your own), then creates a worktree at `../<repo>-worktrees/<prefix>-<slug>`. Slash-only.
- `/repo:pr` — PR description hygiene. Invoked just before `gh pr create`, it rewrites the title and body an agent drafted: conventional-commit title, prose that leads with the problem, and nothing the diff already shows. Strips headings on short bodies, emoji, checklists, filler openers and marketing adjectives. It never opens the PR — the calling agent does that with the returned text.
- `/repo:branch` — branch-policy enforcement guardrail. **Auto-fires on any branch creation, worktree creation, or commit verb.** Refuses commits on `main`/`master` and refuses branch names that don't match one of the required prefixes (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `rnd/`, `hotfix/`). No bypasses.

`/repo:init`, `/repo:branch` and `/repo:pr` auto-trigger when their associated verbs appear in the conversation. `/repo:newbranch` only fires when invoked explicitly.

`/repo:sync` fires when you invoke it, or when a skill that owns a post-merge step delegates to it instead of hand-rolling the same git commands — `/spades:close` and `/spades:loop` are the reference cases. Delegation is the point: post-merge cleanup should have exactly one implementation. A caller must surface `/repo:sync`'s refusals verbatim and stop; auto-stashing or retrying around them defeats the guardrail.

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

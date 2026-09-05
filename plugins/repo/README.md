# repo — personal repo workflow helpers

Six skills, one repo lifecycle:

- `/repo:init` — bootstrap a brand-new repo **in the current directory** (never in a new wrapper folder). Commits a placeholder `README.md`, wires `origin` (creating the GitHub repo if you ask), pushes `main`.
- `/repo:sync` — post-merge git reset. Switches to the default branch, fetches with prune, fast-forwards to origin, and deletes the just-merged local feature branch. Aborts on a dirty tree or a detached HEAD, and warns instead of deleting a branch holding more local commits than a squash-merge would explain.
- `/repo:newbranch` — create a branch and worktree for new work, directly or through callers such as `/spades:scope`. Checks only the default-branch checkout for dirty files, fetches/pulls remote updates, rejects local-only default-branch commits, and uses the verified commit explicitly. Other branches and worktrees stay untouched. `--resume <branch>` returns existing work and asks about uncommitted changes before inclusion; committed work already belongs to that branch's PR.
- `/repo:pr` — PR description hygiene. Invoked just before `gh pr create`, it rewrites the title and body an agent drafted: conventional-commit title, prose that leads with the problem, and nothing the diff already shows. Strips headings on short bodies, emoji, checklists, filler openers and marketing adjectives. It never opens the PR — the calling agent does that with the returned text.
- `/repo:branch` — branch-policy enforcement guardrail. **Auto-fires on any branch creation, worktree creation, or commit verb.** Refuses commits on `main`/`master` and refuses branch names that don't match one of the required prefixes (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `rnd/`, `hotfix/`). No bypasses.

`/repo:newbranch` accepts direct requests and delegation from other skills. It owns preparation for new work; callers use its returned worktree path for every command and worker.

`/repo:sync` remains available for an explicit post-merge cleanup request.
Creating or completing work does not invoke cleanup. Existing branches,
worktrees, files and staging stay available for their own work and PRs.

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

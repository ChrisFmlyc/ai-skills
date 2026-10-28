# repo — personal repo workflow helpers

Five skills and a hook, one repo lifecycle:

- `/repo:init` — bootstrap a brand-new repo **in the current directory** (never in a new wrapper folder). Commits a placeholder `README.md`, wires `origin` (creating the GitHub repo if you ask), pushes `main`.
- `/repo:sync` — post-merge git reset. Switches to the default branch, fetches with prune, fast-forwards to origin, and deletes the just-merged local feature branch. Aborts on a dirty tree or a detached HEAD, and warns instead of deleting a branch holding more local commits than a squash-merge would explain.
- `/repo:newbranch` — create a branch and worktree for new work, directly or through callers such as `/spades:scope`. Checks only the default-branch checkout for dirty files, fetches/pulls remote updates, rejects local-only default-branch commits, and uses the verified commit explicitly. Other branches and worktrees stay untouched. `--resume <branch>` returns existing work and asks about uncommitted changes before inclusion; committed work already belongs to that branch's PR.
- `/repo:pr` — PR title and body hygiene. Invoked just before `gh pr create`, it rewrites the title and body an agent drafted, then runs both through [`/unslop`](https://github.com/theclaymethod/unslop). The title is written to become the squash-merge commit and changelog line: one of nine conventional-commit types, an optional noun scope, an imperative summary, and no issue numbers. The body leads with the problem and leaves out what the diff shows. If `/unslop` is missing, it stops, prints the install command for the agents on your machine, and picks up where it stopped once you have run it. It never opens the PR; the calling agent does that with the returned text.
- `/repo:branch` — branch-policy enforcement guardrail. **Auto-fires on any branch creation, worktree creation, or commit verb.** Refuses commits on `main`/`master` and refuses branch names that don't match one of the required prefixes (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `rnd/`, `hotfix/`).
- **Branch-policy hook** (`hooks/branch_policy.py`) — a PreToolUse hook on Bash that enforces `/repo:branch`'s rules before a command runs. It blocks commits on `main`/`master` (apart from `/repo:init`'s first commit), branch names without a required prefix, `--no-verify`, `core.hooksPath` overrides, pushes that write `main` from another branch, and renaming `main` away. The agent sees the reason and fixes the command. It needs `python3`; without it, or if it hits an internal error, it allows the command rather than block unrelated work. Codex runs the same hook, but only after you trust it: run `/hooks` in the `codex` TUI, and again after each upgrade or any other change to the plugin's files. Tests: `python3 -m unittest discover -s plugins/repo/hooks`.

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

`/repo:pr` also needs the `/unslop` skill. Add `-a cursor` or `-a codex` for each of those agents you use:

```bash
npx skills add theclaymethod/unslop -g -a claude-code
```

## Update

```
/plugin marketplace update ai-skills
/plugin update repo@ai-skills
```

## Uninstall

```
/plugin uninstall repo@ai-skills
```

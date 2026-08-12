---
name: newbranch
description: Start a new piece of work. Runs /repo:sync first to get local main in sync with origin, then takes a one-line description, proposes a <prefix>/<slug> branch name (validated against /repo:branch's regex), confirms with you, and creates a git worktree at ../<repo>-worktrees/<prefix>-<slug>.
disable-model-invocation: true
metadata:
  version: "0.1.0"
---

# repo:newbranch — sync, propose, confirm, create the worktree

Closes the loop between `/repo:sync` (clean main) and `/repo:branch` (validates names). This skill takes a one-line description of the next piece of work, syncs first, proposes a `<prefix>/<slug>` branch name, confirms with you, then creates a git worktree off the latest `main`.

Slash-only — it writes a new worktree to disk, so invoke it deliberately.

## 1. Read the description

Anything after `/repo:newbranch` in the user's message is the description. If the message is just `/repo:newbranch` with nothing after it, ask once:

> What's the change about? One short sentence is fine — I'll propose a branch name.

Wait for their next message and treat that as the description. Don't guess from earlier conversation context.

## 2. Run sync first (always)

Follow the **`/repo:sync` skill body procedure verbatim** before doing anything else. The skill is cheap — at worst a single `git fetch` — and guarantees the new worktree is created off the latest `main`.

If sync **refuses** (dirty tree, detached HEAD, default-branch-undetectable, etc.): **stop**. Surface sync's exact refusal message. Do not create a branch. The user fixes the underlying issue and re-runs `/repo:newbranch`.

When sync succeeds it ends with one of three lines. Handle each:

- `On main, synced to origin (now at <sha>). No feature branch to clean up. Ready.` → proceed.
- `On main, synced to origin … Cleaned up: <branch>. Ready.` → proceed.
- `… Kept <branch> (upstream still exists / no upstream — not safe to delete automatically). Ready.` → the user has an unmerged feature branch checked out. **Pause** and ask:

  > You're still on `<branch>` from an unmerged PR. Switch to `main` first, or shall I make the new worktree anyway off `main` (your unmerged branch stays intact)?

  If they say go ahead, proceed — the worktree is always created off `main`, never off the current branch. If they want to switch, stop and let them.

## 3. Generate the branch proposal

Produce `<prefix>/<slug>` from the description.

### Prefix inference

Map keywords to one of `/repo:branch`'s seven prefixes:

| Description hints                                     | Prefix       |
|-------------------------------------------------------|--------------|
| "add", "new", "build", "introduce", "support for"     | `feat/`      |
| "fix", "broken", "bug", "regression", "wrong"         | `fix/`       |
| "bump", "upgrade", "deps", "tidy", "remove unused", "ci", "github action", "workflow" | `chore/`     |
| "document", "readme", "docstring", "comment"          | `docs/`      |
| "restructure", "rename", "move", "extract", "refactor" (no behaviour change) | `refactor/`  |
| "spike", "experiment", "try", "explore", "prototype", "rnd", "research" | `rnd/`       |
| "urgent", "hotfix", "prod down", "production fix"     | `hotfix/`    |

If the description doesn't clearly match one bucket, default to `feat/` and surface the assumption in your proposal message: *"(defaulted to `feat/` — say so if it's actually `fix/` / `chore/` / …)"*.

### Slug generation

1. Lowercase the description.
2. Replace anything outside `[a-z0-9]` with `-`.
3. Collapse runs of `-` to a single `-`.
4. Trim leading/trailing `-`.
5. If the slug is > 50 chars, truncate at the last `-` that's ≤ 50.

Examples:
- "add a dark mode toggle" → `feat/dark-mode-toggle`
- "Fix the login redirect loop" → `fix/login-redirect-loop`
- "bump vitest to v5" → `chore/bump-vitest-to-v5`
- "spike on streaming LLM output" → `rnd/spike-on-streaming-llm-output`

### Validate the proposal

The proposed branch name must match `/repo:branch`'s authoritative regex:

```
^(feat|fix|chore|docs|refactor|rnd|hotfix)/[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$
```

If the generated slug ends up empty (description was only stopwords / punctuation) or otherwise fails the regex, tell the user and ask for a longer description.

## 4. Confirm with the user via AskUserQuestion

Present a single AskUserQuestion with three options:

- **a)** `Use ${proposed} (Recommended)` — accept the proposal as-is.
- **b)** `Regenerate from a new description` — user will type a new description.
- **c)** `I'll type the full branch name myself` — user will type a verbatim name.

### Branching on the user's choice

**On (a):** proceed to step 5 with `${proposed}`.

**On (b):** plain-text follow-up message:

> OK, what's the change about?

Wait for the next user message. Treat it as the new description. Go back to step 3. Loop until the user accepts a proposal or switches to (c).

**On (c):** plain-text follow-up:

> OK, type the exact branch name. It must match `^(feat|fix|chore|docs|refactor|rnd|hotfix)/[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$`.

Wait for the next user message. Validate against the regex. If it fails, point at the specific rule that was broken (wrong prefix / uppercase / underscore / leading or trailing `-` / length / etc.) and show the prefix table from `/repo:branch`. Ask again. Loop until the input is valid, or the user redirects back to (a) / (b).

## 5. Create the worktree

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
REPO_NAME=$(basename "$REPO_ROOT")
WORKTREE_DIR="$REPO_ROOT/../$REPO_NAME-worktrees/<prefix>-<slug>"
git worktree add -b "<prefix>/<slug>" "$WORKTREE_DIR"
```

The **branch name** keeps the slash (`feat/dark-mode-toggle`); the **worktree path** flattens it to a hyphen (`feat-dark-mode-toggle`) so the folder is one level deep under `<repo>-worktrees/`, not nested.

### Pre-checks (before running `git worktree add`)

- If `$WORKTREE_DIR` already exists on disk: **stop**, tell the user, and ask if they want to pick a different name or remove the existing dir manually. Don't clobber.
- If the branch already exists locally — `git rev-parse --verify <prefix>/<slug>` succeeds — **stop** and ask:

  > Branch `<name>` already exists locally. Options:
  > a) Add the worktree pointing at the existing branch (drop `-b`).
  > b) Pick a different name (back to step 3 or 4c).
  > c) Delete the old branch first (you'd do `git branch -D` yourself, then re-run).

  Don't auto-resolve.

## 6. Exit summary

One short message:

> Worktree ready: `<WORKTREE_DIR>` on branch `<prefix>/<slug>` off `origin/main` (`<short-sha>`). `cd` there to start working.

The skill does not `cd` for the user — its shell state is per-call. The user switches into the worktree path themselves.

## Forbidden in this skill

- Skipping step 2 (the sync).
- Creating the worktree off anything other than the default branch (always `main` / `master`, never the current feature branch).
- Branch names that fail the `/repo:branch` regex.
- `--force` on `git worktree add`.
- Auto-resolving the "branch already exists" or "worktree dir exists" cases without asking.
- Modifying files outside of git's internal metadata and the new worktree path.

## What this skill deliberately does not do

- It does not commit, push, or open PRs.
- It does not delete worktrees or branches afterwards. `/repo:sync` handles post-merge cleanup of the source branch; worktree directory cleanup is a separate, user-initiated step (`git worktree remove <path>`).
- It does not stack branches off other feature branches — always branches from the default branch. Stacked branches stay manual.
- It does not modify branch-protection rules on GitHub.

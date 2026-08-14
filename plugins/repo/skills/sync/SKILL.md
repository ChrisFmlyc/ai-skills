---
name: sync
description: Invoke after a Pull Request (PR) merges, or when a skill that owns a post-merge step hands off to it. /repo:sync switches to the default branch (main/master), fetches with prune, fast-forwards to origin, deletes the just-merged local feature branch, and reports "Ready." so the next branch starts fully in sync; it aborts on a dirty working tree or a detached HEAD rather than discarding anything, and it never pushes.
metadata:
  version: "0.3.1"
---

# repo:sync — post-merge branch reset

The user has just had a PR squash-merged into the default branch on GitHub and the remote feature branch was deleted. This skill brings the local checkout into the same state and leaves a clear-context handoff for the next prompt.

## Who may invoke this

Either the user typing `/repo:sync`, or a skill that owns a post-merge step and delegates to it rather than hand-rolling the equivalent git commands — `/spades:close` and `/spades:loop` are the reference cases. Delegation is the point: the whole reason this skill exists is so post-merge cleanup has exactly one implementation.

It is safe to delegate to because every genuinely destructive path is already refused, not automated. The skill aborts on a dirty working tree and on a detached HEAD, and it warns instead of deleting when a feature branch holds more local commits than a squash-merge would explain. Those refusals belong to the user; a caller must surface them verbatim and stop, never auto-stash, auto-discard, or retry around them.

## Non-goals (do not do these)

- No push, force-push, amend, or rebase.
- No history rewrites on the default branch.
- No `git reset --hard`, no `git clean -fd`, no destructive working-tree commands.

## The flow

Run these in order. If any step fails, stop and surface the error verbatim. Do not paper over.

### 1. Detect the default branch

```bash
git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||'
```

If empty, fall back to:

```bash
git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}'
```

Save as `DEFAULT_BRANCH`. If both fail (no `origin`, or no HEAD ref), abort:

> Could not determine the default branch. Tell me whether this repo uses `main` or `master` and I'll continue.

### 2. Check current branch + working tree

```bash
git rev-parse --abbrev-ref HEAD          # current branch (or "HEAD" if detached)
git status --porcelain                    # non-empty = uncommitted changes
```

If on detached HEAD, abort:

> Detached HEAD — not on a branch. Check out a branch first, then re-run `/repo:sync`.

If `git status --porcelain` returns ANY lines, abort:

> Working tree isn't clean — uncommitted changes on `<branch>`. Commit, stash, or discard them first, then re-run `/repo:sync`.

The user owns this decision. Do not auto-stash, do not auto-discard. (`--porcelain` already excludes gitignored paths, so untracked tooling dirs like `.claude/` won't show up if they're gitignored.)

### 3. If already on the default branch

```bash
git fetch origin --prune
git pull --ff-only
```

Report:

> On `<DEFAULT_BRANCH>`, synced to origin (now at `<short-sha>`). No feature branch to clean up. Ready.

### 4. Otherwise (on a feature branch)

Save the feature branch name as `FEATURE_BRANCH`.

```bash
git fetch origin --prune
```

The `--prune` is load-bearing: after a squash-merge + GitHub branch deletion, this removes the stale remote-tracking ref. The branch's upstream then shows as `[gone]`, which is the signal that the PR was merged.

Detect upstream state:

```bash
git for-each-ref --format='%(upstream:track)' "refs/heads/$FEATURE_BRANCH"
```

- `[gone]` → continue to 4a (the expected post-merge case).
- empty or `[ahead/behind ...]` → upstream still exists; continue to 4b.
- no upstream configured at all → continue to 4c.

### 4a. Upstream is `[gone]` (PR was squash-merged + branch deleted)

```bash
git checkout "$DEFAULT_BRANCH"
git pull --ff-only
```

Before deleting the now-orphaned local branch, check for commits that exist on it but not on the default branch:

```bash
git log "$FEATURE_BRANCH" --not "$DEFAULT_BRANCH" --oneline
```

After a squash-merge this normally shows the original (un-squashed) feature-branch commits — that's expected because the squashed commit on `main` has different hashes. If the list looks roughly like what was in the PR, proceed:

```bash
git branch -D "$FEATURE_BRANCH"
```

`-D` (force) is required because `-d` refuses to delete branches whose commits don't trace into the default branch, and after squash-merge they don't.

If the count is conspicuously larger than the PR contained (you have local-only WIP that never got pushed), STOP and warn:

> `<FEATURE_BRANCH>` has N local commits not on `<DEFAULT_BRANCH>` — that's more than I'd expect from a squash-merge. Confirm there's no unmerged work here before I delete: `git log <FEATURE_BRANCH> --not <DEFAULT_BRANCH>`. Re-run `/repo:sync` once you've checked, or delete manually with `git branch -D <FEATURE_BRANCH>`.

### 4b. Upstream still exists

The PR likely isn't merged yet. Don't delete the local branch. Still bring the default branch up to date:

```bash
git checkout "$DEFAULT_BRANCH"
git pull --ff-only
git checkout "$FEATURE_BRANCH"   # leave the user where they were
```

Report:

> `<FEATURE_BRANCH>` still has an upstream on origin — the PR likely isn't merged yet. Updated `<DEFAULT_BRANCH>` to `<short-sha>` but kept `<FEATURE_BRANCH>` checked out. If you want to abandon this branch anyway, delete it manually with `git branch -D <FEATURE_BRANCH>`. Ready.

### 4c. No upstream configured

The branch was created locally and never pushed. Treat like 4b — don't delete (might be WIP), but offer the explicit-delete command. Switch to default, pull, switch back.

## Output format

End with one tight summary the assistant uses as context for the next prompt. Pick the variant that matches what actually happened:

**Standard post-merge reset (4a):**

> On `<DEFAULT_BRANCH>`, synced to origin (now at `<short-sha>`).
> Cleaned up: `<FEATURE_BRANCH>`.
> Ready.

**Already on default (3):**

> On `<DEFAULT_BRANCH>`, synced to origin (now at `<short-sha>`). No feature branch to clean up. Ready.

**Skipped deletion (4b/4c):**

> On `<DEFAULT_BRANCH>`, synced to origin (now at `<short-sha>`). Kept `<FEATURE_BRANCH>` (upstream still exists / no upstream — not safe to delete automatically). Ready.

The single word "Ready." at the end is the handoff signal: the next user prompt is fresh work, not a continuation of the merged feature.

## After the skill completes

The user's next prompt describes the next piece of work. Branch creation is **not** part of `/repo:sync` — it ends at `Ready.` Defer to `/repo:branch`, which auto-fires on branch-creation verbs and is the authoritative source for the required prefix list (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `rnd/`, `hotfix/`).

## Why these guardrails matter

- **Refuse-on-dirty**: silent stashing has cost the user uncommitted work in the past. Make them choose.
- **`[gone]` detection, not blind deletion**: a branch with an alive upstream may be mid-review on a different machine, or an unmerged WIP. Deleting locally without that signal can lose work.
- **`-D` after squash-merge is intentional**: `git branch -d` will refuse because squash-merge produces a different commit hash. That refusal is a feature, not a bug — but in the squash-merge case we know the work is preserved (in the squashed commit), so `-D` is the right tool.
- **No unprompted runs**: the user runs this between PRs to deliberately reset context. An agent reaching for it on its own ("I see you've merged, let me clean up") may run before the user has reviewed remaining local state. See § Who may invoke this for the boundary.

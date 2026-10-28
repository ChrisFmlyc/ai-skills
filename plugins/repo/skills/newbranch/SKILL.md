---
name: newbranch
description: Creates a branch and dedicated worktree for new work from a clean default branch synchronised with its remote. Use when starting new work, directly or through a caller such as /spades:scope; use --resume <branch> to continue that branch's worktree. Owns default-branch preparation and worktree selection; returns the path without committing, pushing, opening a PR, or cleaning up other work.
metadata:
  version: "0.2.0"
---

# repo:newbranch — prepare the base and return the worktree

New work follows one route:

`main/master → new branch + worktree → commit → push → PR → merge`

This skill owns default-branch cleanliness, remote freshness, naming and
worktree creation. A caller supplies the description, invokes this skill,
then performs its reads, writes, commands and agent dispatches in the
returned worktree. `/spades:scope` calls it before composing a new Scope.
Each branch's commits belong to that branch's PR, whatever its prefix.

## 1. Resolve the request and repository

Accept the description from the human or caller; ask when absent.
`--resume <branch>` selects existing work and goes to § Resume after
resolving the repository. New work always gets a new branch and worktree.

Use `git rev-parse --show-toplevel` and `git worktree list --porcelain`.
Derive the repository name and sibling `<repo>-worktrees` directory from
the primary worktree, so linked-worktree calls use the same layout.
Preserve the invocation worktree's branch, files and index throughout.

Use the caller's configured remote, otherwise `origin` or the sole remote;
ask if ambiguous. Discover its default branch from the remote's advertised
HEAD. With no remote, use the sole existing `main` or `master`; ask if both
exist. Require an existing default branch and commit.

Other branches' commits and dirty files stay in their existing worktrees.
They neither enter the new branch nor block its creation. Inclusion
questions concern the worktree being resumed or delivered (§ Resume).

## 2. Establish a clean, current default branch

Find the worktree checking out `refs/heads/<default>` in the worktree
listing. Run `git -C <default-worktree> status --porcelain=v1`. Any staged,
unstaged or untracked entry is a dirty default checkout: report the paths
and ask the human to resolve them before continuing. Preserve their files
and staging. Other worktrees' status does not gate this step.

With a remote:

```bash
git fetch <remote> refs/heads/<default>:refs/remotes/<remote>/<default>
git rev-parse --verify refs/remotes/<remote>/<default>^{commit}
```

Capture the returned commit as `BASE_SHA`. A fetch failure stops creation;
a cached reference alone is not evidence of freshness. A rejected
non-fast-forward update also needs human resolution.

Compare local `refs/heads/<default>` with `BASE_SHA`. Local-only commits or
divergence require human resolution: display the difference and stop.
A successful pull alone does not detect a local branch that is ahead.

- **Default checked out and clean:** run
  `git -C <default-worktree> pull --ff-only <remote> <default>`. Re-read the
  remote-tracking SHA after pulling and require the local default to equal
  it. Capture this verified commit as `BASE_SHA`.
- **Default exists but is not checked out:** verify it is an ancestor of
  `BASE_SHA`, then advance the existing reference with
  `git update-ref refs/heads/<default> <BASE_SHA> <old-default-sha>`.
  Recheck that it remains unoccupied before updating; stop on concurrent
  checkout or reference changes. The invocation worktree stays untouched.

With no remote, use the clean local default branch's commit as `BASE_SHA`
and report that no remote freshness check is applicable.

Finish by checking the default reference equals `BASE_SHA` and any default
checkout remains clean. `/repo:sync` is a separate post-merge operation;
creating new work requires no branch or worktree cleanup.

## 3. Name and validate

Infer a prefix from the description:

| Intent | Prefix |
|---|---|
| Add functionality | `feat/` |
| Fix a bug or regression | `fix/` |
| Maintenance, dependencies, configuration, CI | `chore/` |
| Documentation | `docs/` |
| Restructure without changing behaviour | `refactor/` |
| Research, experiment, spike | `rnd/` |
| Urgent production fix | `hotfix/` |

Lowercase the description, replace non-alphanumeric runs with hyphens,
collapse and trim hyphens, and truncate at a word boundary to at most 50
characters. An ambiguous intent defaults to `feat/`, stated in the
proposal. Ask for a usable description if the slug is empty.

Invoke `/repo:branch` for authoritative validation. Reuse an explicitly
supplied or previously approved valid name. Otherwise use the structured
question tool: accept the proposal, provide a new description, or type a
name. The caller may answer within authority already granted by the human.

## 4. Create and verify

Use `<primary-parent>/<repo>-worktrees/<prefix>-<slug>` as the path.
If the path or branch exists, ask whether to resume it or choose another
name; preserve it while awaiting the answer.

Create with the captured start commit explicitly supplied:

```bash
git worktree add --no-track -b <branch> <worktree-path> <BASE_SHA>
git -C <worktree-path> rev-parse --abbrev-ref HEAD
git -C <worktree-path> rev-parse HEAD
git -C <worktree-path> status --porcelain=v1
```

Require the requested branch, exactly `BASE_SHA`, and empty status. If a
check fails, report the actual state and preserve the worktree for
inspection. The branch will track its own remote branch when published.

## Resume

Resolve `--resume <branch>` through `git worktree list --porcelain`.
Require an existing non-default branch. If it has a worktree, use that
path. If it exists without one, validate through `/repo:branch` and attach
it with `git worktree add <worktree-path> <branch>`. A missing branch
requires clarification rather than silently recreating completed work.

Committed work already belongs to this branch's PR and needs no inclusion
question. Inspect both the index and working tree. Surface pre-existing
uncommitted changes, including staged deletions and untracked files, and
ask whether to include them in this work's next PR or leave them outside.
Wait before incorporation. Reuse decisions already made for the same
changes; edits known to come from the current authorised run also need no
repeated question. Unknown changes within those same paths still need a
decision. Preserve excluded content and staging. The committing caller
checks the full proposed commit, not just the paths passed to `git add`.

Resume retains the branch's commits and base. Default-branch preparation
applies to new work, not to rewriting work already in progress.

## Return to the caller

Return the repository, branch, absolute worktree path, base commit (new
work), and inclusion decisions (resume). Print:

> Worktree ready: `<path>` on `<branch>`, starting at `<base-sha>`.

The caller uses explicit command working directories or `git -C` and
passes the same absolute path to its agents. A one-off shell `cd` does not
persist session state. Existing branches and worktrees remain available;
this skill does not stash, delete, reset, commit, push, or open a PR.

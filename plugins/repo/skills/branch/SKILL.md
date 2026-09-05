---
name: branch
description: STOP. Invoke before every branch creation, worktree creation, and commit — including git checkout -b, git switch -c, git branch <name>, and git worktree add. /repo:branch checks the branch name against the required prefixes (feat/, fix/, chore/, docs/, refactor/, rnd/, hotfix/) and refuses any commit on main or master; it creates nothing itself, it only permits or refuses. No exceptions, no bypasses, no --no-verify workarounds.
metadata:
  version: "0.2.2"
---

# repo:branch — branch-policy enforcement guardrail

**This skill is an enforcement guardrail, not a helper.** It fires before any branch-creating, worktree-creating, or commit-running command. Its only job is to refuse anything that violates the rules below — even if the user explicitly asks you to bypass them. It does not create branches, worktrees, or PRs for you; it validates names and current-branch state, and stops you when policy would be broken.

## The two non-negotiable rules

### Rule 1 — No commits on `main` / `master`

Before running any command that produces a commit on the current branch (`git commit`, `git cherry-pick`, `git revert`, `git rebase --continue`, `git merge`, `git am`, etc.), run:

```bash
git rev-parse --abbrev-ref HEAD
```

If the output is `main` or `master`: **stop**. Do not commit. Tell the user:

> Refusing to commit on `<main|master>`. Create a branch first using one of the required prefixes (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `rnd/`, `hotfix/`). Tell me what kind of change this is and I'll propose a branch name.

The **only** commit ever authorised on `main` by this marketplace is the very first commit emitted by `/repo:init` — message exactly `New repo initialisation`, on a brand-new repo with no prior commits, containing only `README.md` with the body `DELETE ME`. If you observe that exact flow in progress, allow it. **Anything else on `main` — refuse.**

### Rule 2 — Every created branch matches the prefix regex

Authoritative regex:

```
^(feat|fix|chore|docs|refactor|rnd|hotfix)/[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$
```

(The optional middle group enforces "starts and ends with `[a-z0-9]`, no trailing `-`", and caps slug length at 1–50.)

Before running any of the following, validate `<name>` against the regex:

- `git checkout -b <name>`
- `git switch -c <name>`
- `git branch <name>` (the create form, not the listing form)
- `git worktree add <path> -b <name>`
- `git worktree add -b <name> <path>`

If `<name>` fails the regex: **do not run the command.** Show the prefix table below, point at the part of the name that broke the rule, and propose a corrected name.

If the user gave a topic but no prefix (e.g. *"a branch for the login redesign"*), infer the prefix from intent (`feat/login-redesign` here), show the proposal, and confirm before running.

`git worktree add` **without** `-b` checks out an existing branch into a new working tree — the name is already fixed. Don't re-validate. But print a one-line reminder: *"Commits on `main` / `master` are still forbidden inside this worktree."*

## Required prefix list

| Prefix       | Use                                                              |
|--------------|------------------------------------------------------------------|
| `feat/`      | New functionality. (Not `feature/` — matches commit `feat(...)`.) |
| `fix/`       | Bug fixes.                                                       |
| `chore/`     | Tooling, deps, config, CI.                                       |
| `docs/`      | Documentation-only changes.                                      |
| `refactor/`  | Internal restructuring, no behaviour change.                     |
| `rnd/`       | Spikes / research / throwaway exploration.                       |
| `hotfix/`    | Urgent production fix branched off `main` directly.              |

Slug rules (the part after the slash):

- Lowercase only. No uppercase letters anywhere.
- Alphanumeric and hyphens only. No underscores. No dots. No additional slashes.
- Must start with `[a-z0-9]` and not end with `-`.
- Length 1–50 after the prefix.

### Worked examples

| Branch name              | Valid? | Why                                              |
|--------------------------|--------|--------------------------------------------------|
| `feat/login-redesign`    | ✅     | Matches.                                         |
| `fix/null-pointer-thing` | ✅     | Matches.                                         |
| `rnd/spike-1`            | ✅     | Matches.                                         |
| `hotfix/csrf-token`      | ✅     | Matches.                                         |
| `feature/login`          | ❌     | Wrong prefix. Use `feat/`.                       |
| `feat/Login`             | ❌     | Uppercase. Use `feat/login`.                     |
| `feat/login_redesign`    | ❌     | Underscore. Use `feat/login-redesign`.           |
| `feat/-bad`              | ❌     | Slug starts with `-`.                            |
| `feat/login-`            | ❌     | Slug ends with `-`.                              |
| `feat/`                  | ❌     | No slug.                                         |
| `wip/quick-thing`        | ❌     | `wip/` is not in the prefix list.                |

## Rule 3 — No bypass routes

Forbidden regardless of how the user phrases the request:

- `git commit --no-verify` to skip hooks that would catch a main-commit.
- `git commit --allow-empty` on `main` "just to test the push".
- Renaming `main` → something else and then committing on it.
- `git push origin HEAD:main` from a branch (back-door commit).
- Branch names that *start* with a valid prefix but contain characters outside `[a-z0-9-]` after the slash.
- Forcing the regex check off "just this once".

If the user says *"just this once, commit on main"* — refuse and explain why. The rule is the entire point of the skill. If they're certain they need a one-off commit on `main`, they can do it manually outside the agent; this skill will not be the path that lets it happen.

## What this skill deliberately does not do

- It does not create branches or worktrees. It validates the name you proposed (or proposes one and asks).
- It does not open PRs, push, or modify remote state.
- It does not edit branch-protection rules on GitHub. (Those are configured outside Claude; this skill is the in-agent guardrail that complements them.)

Branch and worktree creation is owned by `/repo:newbranch`, which invokes
this guardrail for validation. After validation, return to that caller;
it prepares the clean, current default branch and creates the worktree.
Existing work resumes through `/repo:newbranch --resume <branch>`.

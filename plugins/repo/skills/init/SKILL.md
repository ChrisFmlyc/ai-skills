---
name: init
description: New repo? Run git init *in this directory* (never wrap it in a new folder). Commit a placeholder README, wire origin, push to main. Use when someone says "init this as a new repo" or "set up a new repo here".
metadata:
  version: "0.2.0"
---

# repo:init — bootstrap a new repo in the current directory

The user wants to turn the current working directory into a fresh git repo and get a first commit onto `origin/main`. Everything after that goes via branches and PRs (CodeRabbit reviews the PRs; `codereview:fix` handles findings).

## The load-bearing rule

> Run `git init` in the **current working directory**. Never `mkdir <name> && cd <name> && git init`. If the user wants the repo to live in a subdirectory, ask them to `cd` there first — do not create the wrapper folder yourself.

The rule only applies to wrapping the *new repo* in a folder. You can still create sub-folders **inside** the repo for organisation once it's initialised.

## Pre-flight (stop with a clear message if any check fails)

1. `git rev-parse --is-inside-work-tree` — if this prints `true`, the directory is already a git repo. Stop and tell the user.
2. If a `README.md` exists with content other than `DELETE ME`, stop and ask before overwriting.
3. Print `pwd` to the user in one short line and confirm before running anything. `git init` itself is reversible, but the user should see which directory they're about to imprint.

## Bootstrap sequence (run verbatim, in order)

```bash
git init -b main
printf "DELETE ME\n" > README.md
git add README.md
git commit -m "New repo initialisation"
```

Notes:
- `-b main` forces the initial branch name even on machines whose `init.defaultBranch` is unset.
- `printf` (not `echo`) for portable newline handling.
- The commit message wording matches the user's convention (British spelling: "initialisation").
- **First commit is README-only.** Any other files already in the directory stay untracked — they'll get added later on a branch, preserving the everything-via-PR rule. Never `git add .` / `git add -A` / `git add <anything else>` in this first commit.

## Remote: ask once, branch on the reply

After the first commit, check `git remote get-url origin` — expect failure (no origin yet).

**Compute a suggested slug** from `basename "$PWD"`:

- If the dirname is already a clean slug (lowercase, alphanumeric + hyphens, **and** not a generic placeholder like `tmp`, `temp`, `project`, `code`, `new`, a date, or a single letter) → use it as-is.
- Otherwise normalise: lowercase, spaces/underscores → hyphens, strip anything outside `[a-z0-9-]`. If the normalised result is still generic or empty, **drop the suggestion** and skip straight to asking for a description.

**Ask the user once**, in one compact message:

> Repo name suggestion: **`<suggested-slug>`** (from current directory `<basename>`).
> Pick one:
> a) Create on GitHub as `<suggested-slug>` — I'll run `gh repo create`.
> b) Create on GitHub with a different name — reply with the slug or a short description.
> c) Use an existing remote — paste the URL.

If no slug could be suggested, drop option (a) and ask: "What should this repo be called? A short description is fine — I'll propose a slug."

**Branch on the reply:**

1. **"a" / yes / use the suggestion** → proceed with `<suggested-slug>`.
2. **User types a slug directly** (matches `^[a-z0-9][a-z0-9._-]*$`, length ≤ 100) → use it verbatim. If validation fails, show the issue and ask again.
3. **User types a description** (free text, not a valid slug) → propose a slug from it using the same normalisation rules. Show the proposal and confirm before running.
4. **User pastes a URL** (starts with `https://`, `http://`, `git@`, or `ssh://`) → **skip `gh repo create` entirely**. Run:
   ```bash
   git remote add origin <url>
   git push -u origin main
   ```
   Done — print the URL and a one-line summary.

## Cases 1–3: create on GitHub

1. Run `gh auth status`. If it fails, stop and tell the user to run `gh auth login` themselves — that flow is interactive and not safe for the agent to drive.
2. Ask for visibility (`--private` vs `--public`). Default to `--private`.
3. Run, with the chosen slug:
   ```bash
   gh repo create <slug> --source=. --private --remote=origin --push
   ```
   (Swap `--private` for `--public` if the user picked public.) This single command creates the GitHub repo, adds it as `origin`, and pushes `main`.
4. On success, print the URL: `gh repo view --json url -q .url`.

## Forbidden in this skill

- Wrapping the new repo in a directory you created (the load-bearing rule).
- `git add .` / `git add -A` / `git add <anything other than README.md>` in the first commit.
- Any form of `--force` / `-f`. Force-pushing a brand-new `main` is never warranted.
- Skipping the placeholder `README.md` — it is the user's chosen sentinel so the first push has content.
- Running `gh repo create` without an explicit yes from the user in their own words.
- `--no-verify`, `--no-gpg-sign`.

## Exit state

Branch `main` exists locally and on `origin` with exactly one commit (`New repo initialisation`). Print a one-line summary and stop:

> `main → origin/main, 1 commit, repo at <url>`

Everything from here goes via a branch + PR.

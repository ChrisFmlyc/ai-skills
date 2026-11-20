---
name: init
description: Invoke when the current directory needs to become a new git repo — "init this as a new repo", "set up a new repo here". /repo:init runs git init in the directory you are already in, never wrapping it in a new folder, then commits a placeholder README, wires origin (creating the repo on GitHub or GitLab if asked), and pushes main; everything after that first commit goes via a branch and a Pull Request (PR).
metadata:
  version: "0.4.1"
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
> a) Create on GitHub as `<suggested-slug>` and push `main` (the placeholder README commit) to it — I'll run `gh repo create`, then `git push`.
> b) Create on GitHub with a different name and push `main` to it — reply with the slug or a short description.
> c) Create on GitLab as `<suggested-slug>` and push `main` to it — I'll create the project with `glab`. Say if it belongs in a group (`group/<slug>`) or on a self-managed GitLab host rather than gitlab.com.
> d) Use an existing remote — paste the URL.

If no slug could be suggested, drop option (a) and the slug from option (c), and ask: "What should this repo be called? A short description is fine — I'll propose a slug."

**Branch on the reply:**

1. **"a" / yes / use the suggestion** → proceed with `<suggested-slug>`. **"c"**, or GitLab named in the reply → the same slug rules, then § Create on GitLab instead of GitHub.
2. **User types a slug directly** (matches `^[a-z0-9][a-z0-9._-]*$`, length ≤ 100) → use it verbatim. If validation fails, show the issue and ask again.
3. **User types a description** (free text, not a valid slug) → propose a slug from it using the same normalisation rules. Show the proposal and confirm before running.
4. **User pastes a URL** (starts with `https://`, `git@`, or `ssh://`; a plain `http://` URL also lands here and is refused at step 1) → **skip `gh repo create` entirely**. The URL decides where this directory's code is published, so nothing is pushed until the user has confirmed where it will go:
   1. Accept the URL only if the whole of it matches `^(https://|ssh://|git@)[A-Za-z0-9._~:/@%+-]+$`. That covers every ordinary remote URL and rules out whitespace, newlines, quotes, `$`, `;` and anything else a shell would act on. If it does not match, show it back, say which character is the problem, and ask again. An `http://` URL fails on purpose: plain HTTP sends the code and any credentials unencrypted, so ask for the `https://` or SSH form instead.
   2. Add it as one single-quoted argument after `--`, so it can never be read as an option, then list every URL git will push to. `git push` sends to each of them, and the user's git config can rewrite the URL (`url.<base>.insteadOf`, `pushInsteadOf`) or add more (`remote.origin.pushurl`, `remote.origin.url`):
      ```bash
      git remote add -- origin '<url>'
      git remote get-url --push --all origin
      ```
   3. If any URL it printed starts with `http://`, in any letter case, push nothing: run `git remote remove origin`, tell the user which URL is plain HTTP, that it would send the code and any credentials unencrypted, and that nothing was pushed, and stop.
   4. Ask: *"Push `main` to `<push-urls>`?"*, naming every URL it printed, and wait for a yes in the user's own words. On anything else, run `git remote remove origin` and go back to the remote question.
   5. Push, naming both ends of the refspec so a `remote.origin.push` rule in the user's git config cannot send `main` to a different branch, with redirects turned off so a server cannot send the push on to a URL the user has not confirmed, with git limited to HTTPS and SSH, and with `--porcelain` so git reports what happened to `main` at each URL. `GIT_ALLOW_PROTOCOL` overrides git config, `-c` included, so the push sets it to `https:ssh` as well as turning plain HTTP off:
      ```bash
      GIT_ALLOW_PROTOCOL=https:ssh git -c protocol.http.allow=never -c http.followRedirects=false push --porcelain -u origin refs/heads/main:refs/heads/main
      ```
      After every push, whatever git's exit code, read the result as follows. Git pushes to the URLs in the order it listed them. For each URL it reaches, it prints `To <url>` and then a status line for `main`: a flag, a tab, `refs/heads/main:refs/heads/main`, a tab and a summary. An error git cannot get past ends the push at the URL it was on, so that URL and every one after it have no `To <url>` line. Sort every URL git listed into one of three groups:
      - **Has `main`**: the flag is `*`, `=` or a space.
      - **Did not get `main`**: the flag is `!` with any summary other than `[remote failure]`, and the summary says why; or the URL has no `To <url>` line: git sent it nothing, and either stopped on it with the error it printed or never reached it.
      - **Uncertain**: the flag is `!` with the summary `[remote failure]`, which means the remote never confirmed the update, not that it refused it; or a `To <url>` line with no status line for `main` after it. For a created repo, § Push to the created repo asks the host whether it has `main`.

      Tell the user which URLs have `main`, naming only the first group, or that no URL has `main` when that group is empty; then list the URLs that did not get `main`, each with git's summary or error, and the uncertain URLs, as separate groups. When every URL has `main`, the § Exit state summary is the whole report.
      If git stopped because a server redirected the push (`fatal: unable to access '<url>/': The requested URL returned error: 301`, or another `3xx` code), or because a URL git listed uses neither HTTPS nor SSH (`transport '<name>' not allowed`), git sent nothing to that URL. Also run `git remote remove origin` and tell the user which URL git refused and why. For a redirect, ask the user for the repo's current URL, as its host shows it for cloning, and start case 4 again with that URL; otherwise stop.
   Done — print the one-line summary from § Exit state.

## Cases 1–3: create on GitHub

1. Run `gh auth status`. If it fails, stop and tell the user to run `gh auth login` themselves — that flow is interactive and not safe for the agent to drive.
2. Ask for visibility (`--private` vs `--public`). Default to `--private`.
3. Run, with the chosen slug:
   ```bash
   gh repo create <slug> --source=. --private --remote=origin
   ```
   (Swap `--private` for `--public` if the user picked public.) This creates the GitHub repo and adds it as `origin`; `git config --get remote.origin.url` prints the URL it added.
4. Push `main` to that URL as § Push to the created repo describes.
5. Print the URL: `gh repo view --json url -q .url`, with where `main` went when § Push to the created repo calls for it.

## Create on GitLab

1. The host is `gitlab.com` unless the user named another; it must match `^[A-Za-z0-9.-]+$`. A group, if named, must match `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`.
2. Run `glab auth status --hostname <host>`. If it fails, stop and tell the user to run `glab auth login --hostname <host>` themselves.
3. Ask for visibility: `private` (default), `internal` or `public`. The answer is `<visibility>` in the next step.
4. Create the project through the API, which pins the host. For a group, look up its ID first with `glab api --hostname <host> "namespaces/<group with each / as %2F>" | jq .id` and add `-F namespace_id=<id>`:
   ```bash
   glab api --hostname <host> --method POST projects \
     -f name='<slug>' -f path='<slug>' -f visibility='<visibility>' -f default_branch=main \
     | jq -r '.id, .web_url, .ssh_url_to_repo, .http_url_to_repo'
   ```
   A 400 naming the path means the project already exists; ask for another slug.
5. Add the remote — `ssh_url_to_repo`, or `http_url_to_repo` when `glab config get git_protocol --host <host>` prints `https` — with the URL checks and the `git remote add -- origin '<url>'` form from case 4, then push `main` to that URL as § Push to the created repo describes.
6. Print the `web_url`, with where `main` went when § Push to the created repo calls for it.

## Push to the created repo

The question offered creating the repo and pushing `main` together, so the user's yes covers a push to the URL `origin` was added with. `git push` sends to every push URL `origin` has, and the user's git config can rewrite the URL (`url.<base>.insteadOf`, `pushInsteadOf`) or add more (`remote.origin.pushurl`, `remote.origin.url`), so list every URL git will push to first:

```bash
git remote get-url --push --all origin
```

If any URL it prints starts with `http://`, in any letter case, push nothing: run `git remote remove origin`, tell the user which URL is plain HTTP, that it would send the code and any credentials unencrypted, and that the new repo was created but nothing was pushed to it, and stop.

If it prints exactly one URL and that is the URL `origin` was added with, the user's yes already covers the push. Otherwise ask *"Push `main` to `<push-urls>`?"*, naming every URL it printed, and wait for a yes in the user's own words. On anything else, run `git remote remove origin`, tell the user the new repo was created but nothing was pushed to it, and stop.

Then push with case 4's refspec and `--porcelain`, with redirects turned off and git limited to HTTPS and SSH as case 4 describes:

```bash
GIT_ALLOW_PROTOCOL=https:ssh git -c protocol.http.allow=never -c http.followRedirects=false push --porcelain -u origin refs/heads/main:refs/heads/main
```

Read and report the result as case 4 describes, whatever git's exit code. If git stopped on a redirect or on a URL that uses neither HTTPS nor SSH, as case 4 describes, also run `git remote remove origin`, tell the user which URL git refused and why, and that the new repo was created, and stop.

When git listed exactly the URL `origin` was added with and that URL has `main`, the created repo has `main` and the completion output stands as written. Otherwise ask the host's API, which git's URL rewriting does not touch, whether the created repo has `main`: a rewritten URL can still reach the created repo by another address, and an uncertain URL may have reached it.

```bash
gh api repos/<owner>/<slug>/branches/main --silent
glab api --hostname <host> projects/<id>/repository/branches/main
```

Run the line for the host the repo was created on. On GitHub, `<owner>` is the account `gh repo create` created the repo under (`gh api user --jq .login`); on GitLab, `<id>` is the `id` the create step printed. Success means the created repo has `main`, a 404 means it has none, and any other failure means it was not checked. Wherever the completion output prints the created repo's URL, also name the URLs that have `main`, as case 4 sorts them, and say what the host reported.

## Forbidden in this skill

- Wrapping the new repo in a directory you created (the load-bearing rule).
- `git add .` / `git add -A` / `git add <anything other than README.md>` in the first commit.
- Any form of `--force` / `-f`. Force-pushing a brand-new `main` is never warranted.
- Skipping the placeholder `README.md` — it is the user's chosen sentinel so the first push has content.
- Running `gh repo create`, or creating a GitLab project, without an explicit yes from the user in their own words.
- Pushing before the user has confirmed every push URL git lists — always for a pasted URL, and for a created repo unless git lists exactly the one URL `origin` was added with.
- Pushing over plain HTTP or through a redirect: when any URL git lists starts with `http://`, or without the `GIT_ALLOW_PROTOCOL=https:ssh git -c protocol.http.allow=never -c http.followRedirects=false` prefix, which keeps the push to HTTPS and SSH and stops a server redirecting it to a URL the user has not confirmed, `http://` included. Plain HTTP sends the code and any credentials unencrypted, whether the user pasted that URL or their git config produced it.
- `--no-verify`, `--no-gpg-sign`.

## Exit state

Branch `main` exists locally with exactly one commit (`New repo initialisation`) and on every URL case 4's reading sorts into **Has `main`**. Print a one-line summary and stop:

> `main → origin/main, 1 commit, repo at <url>`

That summary fits a push where git listed one URL and it has `main` — for a created repo, the URL `origin` was added with. Otherwise the summary names only the URLs that have `main`, or `no URL` when none does, and, for a created repo, what the host reported for it; the URLs that did not get `main` and the uncertain ones follow it as separate lists, as case 4 describes:

> `main → <URLs that have main>, 1 commit; repo at <url> has main` (or `has no main`, or `not checked for main`)

Everything from here goes via a branch + PR.

---
name: pr
description: Invoke immediately before opening a Pull Request (PR), before running gh pr create. /repo:pr turns the drafted title and body into a conventional-commit title that works as the squash-merge commit and changelog line, and a body that says what changed and why, then runs both through /unslop; if /unslop is not installed it stops, tells the user how to install it, and resumes once it is. It never opens the PR, never pushes, never changes code, and never returns text that has not been through /unslop.
metadata:
  version: "0.2.0"
---

# repo:pr — title and body for a squash-merged Pull Request (PR)

An agent has finished a change and is about to open a PR. Before it runs `gh pr create`, it hands you the title and body it drafted. You rewrite them and hand them back. You never open the PR yourself.

This skill assumes PRs are squash-merged. The title then becomes the commit subject on the default branch, and changelogs and release notes are built from those subjects. GitHub appends ` (#<PR number>)` to it at merge. Write the title for someone skimming the changelog a year from now.

## 1. Check that /unslop is available

Do this before anything else. Every title and body goes through `/unslop` in step 6, and nothing skips it.

Look for `unslop` among the skills you can invoke. If it is there, go to step 2.

If it is not, stop. Rewrite nothing, and tell the calling agent not to open the PR, with the draft or with anything else. Keep the draft exactly as you received it, because you resume from it.

Build the install command for the coding agents on this machine:

```bash
flags=""
{ [ -d ~/.claude ] || command -v claude; } >/dev/null 2>&1 && flags="$flags -a claude-code"
{ [ -d ~/.cursor ] || command -v cursor; } >/dev/null 2>&1 && flags="$flags -a cursor"
{ [ -d ~/.codex ] || command -v codex; } >/dev/null 2>&1 && flags="$flags -a codex"
echo "npx skills add theclaymethod/unslop -g$flags"
```

If the check missed the agent you are running in, add its flag. Then tell the user, with the command you printed:

> `/repo:pr` needs the `/unslop` skill, and it isn't installed. Run this in a terminal:
>
> ```
> npx skills add theclaymethod/unslop -g -a claude-code -a cursor -a codex
> ```
>
> It installs [theclaymethod/unslop](https://github.com/theclaymethod/unslop) for each agent listed. It is third-party code, so read the repo before you run it. Tell me when it has finished and I'll carry on with this PR.

Wait for the reply, then look for `unslop` again.

- **Available now:** continue at step 2 with the draft you kept. When you hand back, the calling agent carries on from where it paused and opens the PR.
- **Still missing:** Claude Code may not see a skill installed mid-session until it restarts. Ask the user to restart with `claude --continue`, which reopens this conversation, then invoke `/repo:pr` again on the same draft.

Do not run the install command yourself. The user decides what third-party code goes on their machine.

## 2. Read the draft and the diff

If you were called without a title or body, there is nothing to rewrite. STOP and raise an ERROR saying no title or body was supplied.

Read the diff as well. You check every claim in the draft against it. Find the default branch first, because `origin/HEAD` is not set in every clone:

```bash
git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null \
  || gh repo view --json defaultBranchRef -q '"origin/" + .defaultBranchRef.name' 2>/dev/null
```

Call what it prints `BASE`, for example `origin/main`, and read the diff with `git diff BASE...HEAD`. If it prints nothing, do not run the diff. Tell the calling agent the default branch could not be found, and ask which branch the PR merges into. Use `origin/<that branch>` as `BASE`.

## 3. Read the repo's own rules

Some repos set their own PR title rules. Look for them before you use the defaults below:

- a commitlint config (`commitlint.config.*`, `.commitlintrc*`), or a workflow that checks PR titles, usually `amannn/action-semantic-pull-request`
- `CONTRIBUTING.md`, and a PR template at `.github/pull_request_template.md`
- recent commit subjects on the default branch: `git log --format=%s -30 BASE`

Where the repo sets a rule, such as its own type list, required scopes, or a template with sections, follow the repo. The git log shows which scopes are in use and how they are spelled. Anything the repo leaves open comes from the rules below.

## 4. Write the title

```
<type>(<scope>): <summary>
```

### Type

Exactly one of:

| Type | Use it for |
|---|---|
| `feat` | a new feature |
| `fix` | a bug fix |
| `refactor` | a code change that neither fixes a bug nor adds a feature |
| `docs` | documentation only |
| `test` | adding tests or fixing existing ones |
| `build` | the build system or process, including dependencies |
| `ci` | CI configuration |
| `chore` | changes that leave what the code means alone: formatting, whitespace, typos in code, comment edits |
| `revert` | undoing an earlier commit |

A dependency bump is `build(deps)`, or `chore(deps)` if the repo's history already uses that. A revert's summary is the subject of the commit it undoes, and its body names that commit or PR.

Put `!` before the colon when the change breaks something for existing users: `refactor(codereview)!: merge single and multi into one fix skill`.

### Scope

Optional. When you use one, it is a noun for the part of the codebase the change touches, such as a plugin, package, module or component, spelled the way the codebase spells it: `feat(RAC)`, `fix(virtualization)`, `fix(repo)`.

- Never an issue or ticket ID. Not `fix(#42)`, not `feat(PROJ-123)`.
- Leave it out for a repo-wide change.
- Leave it out when the change spans two areas, unless the repo's history already joins scopes. This marketplace writes `feat(codereview+repo)`.

### Summary

Someone skimming the changelog should know what changed without opening the PR.

- Imperative mood: `add`, `fix`, `allow`, not `added` or `adds`.
- Lower-case first word, unless it is an identifier: `fix: allow useHref on synthetic links`.
- No full stop at the end.
- Name the change, not the activity. `update the loop skill` tells the reader nothing.
- Keep the whole title under about 70 characters. GitHub truncates longer titles in PR lists and notification emails, and the ` (#123)` it adds at merge needs room. If the change will not fit, the PR is probably doing two things. Tell the calling agent; that is worth knowing before the PR is opened.
- No issue or ticket numbers anywhere in the title. The body links the issue, and GitHub adds the PR number at merge.

| Bad | Good |
|---|---|
| `Fix bug` | `fix(repo): keep branches with unmerged work during sync` |
| `fix(#42): sync deletes branches` | `fix(repo): keep branches with unmerged work during sync`, with `Fixes #42` in the body |
| `Update the loop skill` | `refactor(codereview): hand findings to fix instead of fixing them` |
| `feat: Added support for custom renderers.` | `feat(virtualization): add support for custom collection renderers` |
| `Various improvements to PR handling` | two PRs; this one is doing two things |

## 5. Write the body

The reviewer is about to read the diff and wants to know what to look for.

**Lead with the problem.** Say what was wrong, then what you did about it. A reviewer who understands the problem can judge whether the fix is right. One who only sees the change can only check that it runs.

**Say what the diff cannot.** Why this approach and not the obvious alternative, what you decided and might be wrong about, what you left out on purpose. Anything the reviewer would otherwise have to reverse-engineer.

**Leave out what the diff shows.** No file-by-file walkthrough, no list of renamed functions, no line counts. The reviewer has the diff one tab away.

**Match the length to the change.** A small fix needs 50 to 100 words. A change across several areas earns 300 to 400, a short passage per area. Six paragraphs under a one-line change is worse than none, because the reviewer reads all of it before finding out there was nothing to know.

**Write prose.** Use bullets only for real lists, like three alternatives you considered or four files with the same problem.

**Claim only what was done.** If the tests were not run, there is no Testing section. If a case is untested, say so. It is often the most useful sentence in the body.

**Tell the reviewer where to look.** When the PR touches many files, name the two or three worth reading closely, and the order to read them in if order matters. If you want a particular kind of feedback, ask for it.

**Link what the reader would otherwise hunt for.** Put `Fixes #42` or `Closes #42` on its own line, and GitHub closes the issue when the PR merges. A design doc or an earlier PR gets one line each, not a section.

Strip all of this:

- headings on a short body: no `## Summary`, `## Changes`, `## Testing`. Headings start to help at about five sections.
- emoji in headings and bullets
- checklists nobody ticks, such as `- [ ] Tests added`
- filler openers: "This PR introduces", "This change aims to", "In this pull request we"
- marketing adjectives: robust, comprehensive, seamless, powerful
- a closing paragraph that repeats the first
- diff statistics such as "12 files changed, 340 insertions"

Keep the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer if the draft has one. It is a convention in this marketplace, not filler.

## 6. Run /unslop

Invoke `/unslop` with `rewrite --preset crisp`, passing the title and body from steps 4 and 5 as the input, title on the first line. `rewrite` edits only the sentences it confirms are formulaic and copies the rest byte-for-byte. `crisp` is its preset for technical writing.

Tell it which parts are fixed: the `<type>(<scope>):` prefix, code spans, links, the `Fixes #42` line and the footer.

Use what it returns as the title and body from here on.

## 7. Check the rules again

`/unslop` knows prose, not these rules. Check what it returned:

- The title has an allowed type, a valid scope or none, and a lower-case imperative summary. It is under about 70 characters and has no issue numbers in it.
- No heading, emoji or checklist has come back.
- The footer is still there if the draft had one.
- Nothing is claimed that the draft did not claim.

If `/unslop` broke one of these, put that part back from your step 4 or 5 text. Do not run the whole skill again.

## 8. Hand it back

Return the title and body to the calling agent, and say in one line what changed, for example `retitled to fix(repo): …, dropped 4 headings and a checklist; unslop rewrote 2 sentences`.

Then stop. The calling agent opens the PR with your text.

## Never do this

- run `gh pr create`, `gh pr edit`, or any other command that writes to GitHub
- push, commit, or change any file in the repo
- run the `/unslop` install command; the user does that
- hand back a title or body that has not been through `/unslop`
- add anything the draft did not claim: a test that was not run, a decision that was not made, a reason that was not given
- keep a claim from the draft that the diff gives no evidence for; drop it, or replace it with what you can see
- write a title that does not name the change, however tidy it looks

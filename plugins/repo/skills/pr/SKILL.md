---
name: pr
description: Invoke immediately before opening a Pull Request (PR) — before running gh pr create. /repo:pr rewrites the title and body an AI agent drafted into the house style: a conventional-commit title, prose that says what changed and why, and nothing the diff already shows; it never opens the PR, never pushes, and never changes code.
metadata:
  version: "0.1.0"
---

# repo:pr — shape the Pull Request (PR) title and body before it is opened

## What the skill does

An agent has finished a change and is about to open a PR. Before it does, you rewrite the title and body it drafted.

Agents write bad PR descriptions in predictable ways: they restate the diff file by file, they pad with headings for two-line sections, they claim things were tested that were not, and they write like a product announcement. A reviewer opening that page learns nothing the diff would not have told them.

Your job is to hand back a title and a body worth reading, then get out of the way. **You never run `gh pr create`.** The agent that called you does that, with your text.

## When to invoke this skill

Invoke it when an agent is about to open a PR and has a draft title and body. That is the only case.

If you are called with no draft — nothing to rewrite — STOP and raise an ERROR saying no title or body was supplied.

## The title

One line, in conventional-commit form, matching what the repo already uses:

```
<type>(<scope>): <what changed, lower case>
```

- **Type** is `feat`, `fix`, `refactor`, `chore`, or `docs`.
- **Scope** is the plugin or area touched. Two areas is `feat(codereview+repo)`. No scope is fine for a repo-wide change.
- **Add `!` after the scope** when the change breaks something for existing users: `refactor(codereview)!: merge single and multi into one fix skill`.
- Say what changed, not what the PR is.
- Keep the whole line under about 70 characters — GitHub truncates longer titles in PR lists and notification emails, which is where most people read it. If it will not fit, the PR is doing two things.
- Reference the issue if there is one: `fix(repo): sync deleted a branch with unmerged work (#42)`.

A reviewer should know what they are about to look at before they open the diff:

| Bad | Good |
|---|---|
| `Fix bug` | `fix(repo): sync deleted a branch with unmerged work` |
| `Update the loop skill` | `refactor(codereview): loop hands findings to fix instead of fixing them` |
| `Various improvements to PR handling` | two PRs — this one is doing two things |

If you cannot name the change in one line, say so to the calling agent. That usually means the PR should be split, and that is worth hearing before it is opened.

## The body

Write for someone who is about to read the diff and wants to know what to look for.

**Match the length to the change.** A small fix needs 50 to 100 words — what broke, what you did. A change touching several areas earns 300 to 400, one short passage per area. Beyond that you are restating the diff. A one-line change with six paragraphs under it is worse than no description at all, because the reviewer reads all of it before realising there was nothing to know.

**Lead with the problem, not the change.** Say what was wrong, then what you did about it. A reviewer who understands the problem can judge whether the fix is right; one who only sees the change can only check it compiles.

**Say what the diff cannot.** Why this approach and not the obvious alternative. What you decided and might be wrong about. What you deliberately left out. Anything a reviewer would otherwise have to reverse-engineer.

**Cut anything the diff already shows.** No file-by-file walkthrough, no line counts, no list of renamed functions. GitHub renders all of that directly above your text.

**Prose, not bullet soup.** Bullets are for genuine lists — three alternatives considered, four files with a shared problem. A paragraph broken into fragments is harder to read, not easier.

**Only claim what you did.** If the tests were not run, do not write a Testing section. If a case is untested, say so — that is the most useful sentence in the whole body.

**Point the reviewer where it matters.** When the PR touches many files, name the two or three worth reading closely. When the changes only make sense in a particular order, say which order. When you want a specific kind of feedback — is this the right approach, does this name make sense — ask for it. A reviewer given no steer reads the files alphabetically.

**Link what the reader would otherwise hunt for**: the issue, the design doc, the earlier PR this builds on. One line each, not a section.

## What to strip

Remove all of this, always:

- **Headings on a body this short.** No `## Summary`, `## Changes`, `## Testing`, `## Notes`. If the body is three paragraphs it does not need a table of contents. Headings earn their place from about five sections upward.
- **Emoji in headings and bullets.** ✨ 🚀 🎉 📝 ✅ and the rest.
- **Checklists nobody ticks.** `- [ ] Tests added`, `- [ ] Docs updated`.
- **Filler openers.** "This PR introduces", "This change aims to", "In this pull request we".
- **Marketing adjectives.** Robust, comprehensive, seamless, powerful, significantly improved.
- **A closing summary** that repeats the opening paragraph.
- **Statistics from the diff.** "12 files changed, 340 insertions".

Keep the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer if the draft has one. That is a marketplace convention, not filler.

## Hand it back

Return the rewritten title and body to the agent that called you, and say in one line what you cut — for example `rewrote the title, dropped 4 headings and a checklist`.

Then stop. The calling agent runs `gh pr create` with your text.

## Never do this

- running `gh pr create`, `gh pr edit`, or any other command that writes to GitHub
- pushing, committing, or changing any file in the repo
- inventing anything the draft did not claim — a test that was not run, a decision that was not made, a reason that was not given
- keeping a claim the draft made that you cannot see evidence for in the diff; drop it, or replace it with what you can see
- writing a title that does not name the change, however tidy it looks
